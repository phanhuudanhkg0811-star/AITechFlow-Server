/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, TestScenario } from 'src/generated/prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';
import type { CreateJobWithScenarioDto } from './job.dto';
import { AiService } from '../ai/ai.service';

type ScenarioInput = NonNullable<CreateJobWithScenarioDto['scenarios']>[number];

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  private async getDefaultCompanyId() {
    const defaultCompany = await this.prisma.company.upsert({
      where: { name: 'Default Company' },
      update: {},
      create: { name: 'Default Company' },
    });

    return defaultCompany.id;
  }

  private async getCompanyIdForCreator(creatorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { companyId: true },
    });

    if (user?.companyId) return user.companyId;

    const companyId = await this.getDefaultCompanyId();
    await this.prisma.user.update({
      where: { id: creatorId },
      data: { companyId },
    });

    return companyId;
  }

  private async findOrCreateLegacyEmailAccount(
    email: string | undefined,
    userId: string,
    companyId: string,
  ) {
    if (!email) return null;

    const existing = await this.prisma.emailAccount.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.companyId !== companyId) {
        throw new UnprocessableEntityException(
          'Email account belongs to another company',
        );
      }

      return existing;
    }

    return this.prisma.emailAccount.create({
      data: {
        email,
        encryptedPassword: '',
        userId,
        companyId,
        isActive: false,
      },
    });
  }

  private async resolveEmailAccount(
    dto: CreateJobWithScenarioDto,
    userId: string,
    companyId: string,
  ) {
    if (dto.emailAccountId) {
      const emailAccount = await this.prisma.emailAccount.findUnique({
        where: { id: dto.emailAccountId },
      });

      if (!emailAccount || emailAccount.companyId !== companyId) {
        throw new UnprocessableEntityException(
          'Email account does not belong to your company',
        );
      }

      return emailAccount;
    }

    return this.findOrCreateLegacyEmailAccount(dto.hrEmail, userId, companyId);
  }

  private getScenarioInputs(dto: CreateJobWithScenarioDto): ScenarioInput[] {
    const scenarioInputs = dto.scenarios?.length
      ? dto.scenarios
      : [
          {
            title: dto.scenarioTitle ?? 'Default Test',
            difficulty: dto.difficulty ?? 'Junior',
            timeLimit: dto.timeLimit ?? 90,
            context: dto.scenarioContext ?? 'Complete the assigned task.',
            isDefault: true,
          },
        ];

    const defaultIndex = scenarioInputs.findIndex(
      (scenario) => scenario.isDefault,
    );

    return scenarioInputs.map((scenario, index) => ({
      ...scenario,
      isDefault: defaultIndex === -1 ? index === 0 : index === defaultIndex,
    }));
  }

  private async resolveInitialCode(
    tx: Prisma.TransactionClient,
    scenario: ScenarioInput,
    companyId: string,
  ): Promise<Prisma.InputJsonValue> {
    if (scenario.templateId) {
      const template = await tx.template.findFirst({
        where: {
          id: scenario.templateId,
          OR: [{ isPublic: true }, { companyId }],
        },
        select: { initialCode: true },
      });

      if (!template) {
        throw new UnprocessableEntityException(
          'Template does not belong to your company',
        );
      }

      return (template.initialCode ?? {}) as Prisma.InputJsonValue;
    }

    return (scenario.initialCode ?? {}) as Prisma.InputJsonValue;
  }

  async generateEmbedding(text: string, companyId?: string): Promise<number[]> {
    try {
      this.logger.log('Generating vector embedding with Gemini SDK...');

      return this.aiService.generateEmbedding(text, { companyId });
    } catch (error: any) {
      this.logger.error('Failed to generate vector embedding:', error);
      throw error;
    }
  }

  async createJobAndScenario(dto: CreateJobWithScenarioDto, creatorId: string) {
    this.logger.log(`Creating job description: ${dto.title}`);

    const companyId = await this.getCompanyIdForCreator(creatorId);
    const emailAccount = await this.resolveEmailAccount(
      dto,
      creatorId,
      companyId,
    );

    const scenarioInputs = this.getScenarioInputs(dto);

    const { newJob, newScenarios } = await this.prisma.$transaction(
      async (tx) => {
        const job = await tx.jobDescription.create({
          data: {
            title: dto.title,
            content: dto.content,
            companyId,
            emailAccountId: emailAccount?.id ?? null,
            jobReference: dto.jobReference,
            creatorId,
          },
        });

        const scenarios: TestScenario[] = [];

        for (const scenarioInput of scenarioInputs) {
          const initialCode = await this.resolveInitialCode(
            tx,
            scenarioInput,
            companyId,
          );

          scenarios.push(
            await tx.testScenario.create({
              data: {
                jobId: job.id,
                title: scenarioInput.title,
                difficulty: scenarioInput.difficulty,
                timeLimit: scenarioInput.timeLimit,
                context: scenarioInput.context,
                templateId: scenarioInput.templateId,
                initialCode,
                isDefault: scenarioInput.isDefault,
              },
            }),
          );
        }

        const defaultScenario = scenarios.find(
          (scenario) => scenario.isDefault,
        );

        const jobWithDefault = await tx.jobDescription.update({
          where: { id: job.id },
          data: { defaultScenarioId: defaultScenario?.id ?? scenarios[0]?.id },
        });

        return { newJob: jobWithDefault, newScenarios: scenarios };
      },
    );

    try {
      this.logger.log('Generating vector embedding for job content...');

      const embeddingVector = await this.generateEmbedding(
        dto.content,
        companyId,
      );
      const vectorString = `[${embeddingVector.join(',')}]`;

      await this.prisma.$executeRawUnsafe(`
        UPDATE "JobDescription"
        SET "embedding" = '${vectorString}'::vector
        WHERE id = '${newJob.id}'
      `);

      this.logger.log('Job created and vector stored successfully.');
    } catch (error) {
      this.logger.error('Warning: failed to generate Gemini embedding:', error);
    }

    return { job: newJob, scenarios: newScenarios };
  }

  async updateJob(
    id: string,
    creatorId: string,
    dto: CreateJobWithScenarioDto,
  ) {
    const job = await this.prisma.jobDescription.findFirst({
      where: { id, creatorId },
      include: {
        scenarios: {
          include: { _count: { select: { testSessions: true } } },
        },
      },
    });

    if (!job) {
      throw new Error('Job not found or you do not have permission to edit it');
    }

    const emailAccount = await this.resolveEmailAccount(
      dto,
      creatorId,
      job.companyId,
    );

    const updatedJob = await this.prisma.$transaction(async (tx) => {
      const updatedJD = await tx.jobDescription.update({
        where: { id },
        data: {
          title: dto.title,
          content: dto.content,
          emailAccountId: emailAccount?.id ?? null,
          jobReference: dto.jobReference,
        },
      });

      const scenarioInputs = this.getScenarioInputs(dto);
      const existingScenarioIds = new Set(
        job.scenarios.map((scenario) => scenario.id),
      );
      const incomingIds = new Set(
        scenarioInputs
          .map((scenario) => scenario.id)
          .filter((scenarioId): scenarioId is string => Boolean(scenarioId)),
      );

      for (const existingScenario of job.scenarios) {
        if (
          !incomingIds.has(existingScenario.id) &&
          existingScenario._count.testSessions === 0
        ) {
          await tx.testScenario.delete({ where: { id: existingScenario.id } });
        }
      }

      const savedScenarios: TestScenario[] = [];

      for (const scenarioInput of scenarioInputs) {
        const initialCode = await this.resolveInitialCode(
          tx,
          scenarioInput,
          job.companyId,
        );

        if (scenarioInput.id) {
          if (!existingScenarioIds.has(scenarioInput.id)) {
            throw new UnprocessableEntityException(
              'Scenario does not belong to this job',
            );
          }

          savedScenarios.push(
            await tx.testScenario.update({
              where: { id: scenarioInput.id },
              data: {
                title: scenarioInput.title,
                difficulty: scenarioInput.difficulty,
                timeLimit: scenarioInput.timeLimit,
                context: scenarioInput.context,
                templateId: scenarioInput.templateId,
                initialCode,
                isDefault: scenarioInput.isDefault,
              },
            }),
          );
        } else {
          savedScenarios.push(
            await tx.testScenario.create({
              data: {
                jobId: id,
                title: scenarioInput.title,
                difficulty: scenarioInput.difficulty,
                timeLimit: scenarioInput.timeLimit,
                context: scenarioInput.context,
                templateId: scenarioInput.templateId,
                initialCode,
                isDefault: scenarioInput.isDefault,
              },
            }),
          );
        }
      }

      const defaultScenario = savedScenarios.find(
        (scenario) => scenario.isDefault,
      );

      await tx.jobDescription.update({
        where: { id },
        data: {
          defaultScenarioId:
            defaultScenario?.id ?? savedScenarios[0]?.id ?? null,
        },
      });

      return updatedJD;
    });

    try {
      this.logger.log(`Regenerating vector embedding for job ID: ${id}...`);

      const embeddingVector = await this.generateEmbedding(
        dto.content,
        job.companyId,
      );
      const vectorString = `[${embeddingVector.join(',')}]`;

      await this.prisma.$executeRawUnsafe(`
        UPDATE "JobDescription"
        SET "embedding" = '${vectorString}'::vector
        WHERE id = '${id}'
      `);

      this.logger.log('Job vector updated successfully.');
    } catch (error) {
      this.logger.error('Warning: failed to update Gemini embedding:', error);
    }

    return { message: 'Campaign updated successfully', job: updatedJob };
  }

  async deleteJob(id: string, creatorId: string) {
    const job = await this.prisma.jobDescription.findFirst({
      where: { id, creatorId },
    });

    if (!job) {
      throw new Error(
        'Job not found or you do not have permission to delete it',
      );
    }

    return this.prisma.jobDescription.delete({
      where: { id },
    });
  }
}
