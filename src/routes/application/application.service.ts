import { Injectable } from '@nestjs/common';
import type { AppStatus } from 'src/generated/prisma/client';
import { PrismaService } from 'src/shared/services/prisma.service';

type CandidateTestItem = {
  id: string;
  applicationId: string;
  status: AppStatus;
  job: { title: string };
  testSession: {
    id: string;
    endTime: Date | null;
    scenario: {
      id: string;
      title: string;
      difficulty: string;
      timeLimit: number;
      context: string;
    };
  };
};

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async getApplicationsByUserId(userId: string) {
    const applications = await this.prisma.application.findMany({
      where: { userId: userId },
      select: {
        id: true,
        status: true,
        job: {
          select: {
            title: true,
            scenarios: {
              select: {
                id: true,
                title: true,
                difficulty: true,
                timeLimit: true,
                context: true,
              },
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
      orderBy: { status: 'asc' },
    });

    const tests: CandidateTestItem[] = [];

    for (const application of applications) {
      const existingSessions = await this.prisma.testSession.findMany({
        where: { applicationId: application.id },
        select: {
          id: true,
          endTime: true,
          scenario: {
            select: {
              id: true,
              title: true,
              difficulty: true,
              timeLimit: true,
              context: true,
            },
          },
        },
      });

      const sessionByScenarioId = new Map(
        existingSessions.map((session) => [session.scenario.id, session]),
      );

      if (application.status === 'TESTING') {
        const missingScenarios = application.job.scenarios.filter(
          (scenario) => !sessionByScenarioId.has(scenario.id),
        );

        for (const scenario of missingScenarios) {
          const session = await this.prisma.testSession.create({
            data: {
              applicationId: application.id,
              scenarioId: scenario.id,
            },
            select: {
              id: true,
              endTime: true,
              scenario: {
                select: {
                  id: true,
                  title: true,
                  difficulty: true,
                  timeLimit: true,
                  context: true,
                },
              },
            },
          });

          sessionByScenarioId.set(session.scenario.id, session);
        }
      }

      for (const scenario of application.job.scenarios) {
        const session = sessionByScenarioId.get(scenario.id);

        if (!session) continue;

        tests.push({
          id: session.id,
          applicationId: application.id,
          status: application.status,
          job: { title: application.job.title },
          testSession: session,
        });
      }
    }

    return tests;
  }
}
