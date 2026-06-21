import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { TemplateType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/shared/services/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './template.dto';

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  createPublicTemplate(dto: CreateTemplateDto, userId: string) {
    this.validateTemplateDto(dto);

    return this.prisma.template.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        templateType: dto.templateType,
        initialCode: dto.initialCode as Prisma.InputJsonValue,
        isPublic: true,
        createdBy: userId,
        companyId: null,
      },
    });
  }

  async createPrivateTemplate(
    companyId: string,
    dto: CreateTemplateDto,
    userId: string,
  ) {
    this.validateTemplateDto(dto);
    await this.assertCompanyExists(companyId);

    return this.prisma.template.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        templateType: dto.templateType,
        initialCode: dto.initialCode as Prisma.InputJsonValue,
        isPublic: false,
        createdBy: userId,
        companyId,
      },
    });
  }

  listTemplates(actor: { role: string; companyId?: string }) {
    return this.prisma.template.findMany({
      where:
        actor.role === 'ADMIN'
          ? undefined
          : {
              OR: [{ isPublic: true }, { companyId: actor.companyId }],
            },
      orderBy: [{ isPublic: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        templateType: true,
        initialCode: true,
        isPublic: true,
        companyId: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { scenarios: true } },
      },
    });
  }

  async updateTemplate(
    id: string,
    dto: UpdateTemplateDto,
    actor: { role: string; companyId?: string },
  ) {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');

    this.assertCanModifyTemplate(template, actor);
    this.validateTemplateDto(dto, true);

    return this.prisma.template.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined ? undefined : dto.description?.trim(),
        templateType: dto.templateType,
        initialCode:
          dto.initialCode === undefined
            ? undefined
            : (dto.initialCode as Prisma.InputJsonValue),
      },
    });
  }

  async deleteTemplate(
    id: string,
    actor: { role: string; companyId?: string },
  ) {
    const template = await this.prisma.template.findUnique({
      where: { id },
      include: { _count: { select: { scenarios: true } } },
    });
    if (!template) throw new NotFoundException('Template not found');

    this.assertCanModifyTemplate(template, actor);

    if (template._count.scenarios > 0) {
      throw new BadRequestException(
        'Template is used by existing test scenarios and cannot be deleted',
      );
    }

    return this.prisma.template.delete({ where: { id } });
  }

  private validateTemplateDto(
    dto: {
      name?: string;
      description?: string | null;
      templateType?: TemplateType;
      initialCode?: unknown;
    },
    partial = false,
  ) {
    if (!partial || dto.name !== undefined) {
      if (!dto.name?.trim()) throw new BadRequestException('Name is required');
    }

    if (!partial || dto.templateType !== undefined) {
      if (!dto.templateType || !(dto.templateType in TemplateType)) {
        throw new BadRequestException('Invalid template type');
      }
    }

    if (!partial || dto.initialCode !== undefined) {
      if (
        dto.initialCode === null ||
        typeof dto.initialCode !== 'object' ||
        Array.isArray(dto.initialCode)
      ) {
        throw new BadRequestException('initialCode must be a file tree object');
      }
    }
  }

  private assertCanModifyTemplate(
    template: { isPublic: boolean; companyId: string | null },
    actor: { role: string; companyId?: string },
  ) {
    if (actor.role === 'ADMIN') return;

    if (template.isPublic) {
      throw new ForbiddenException('Only ADMIN can modify public templates');
    }

    if (!actor.companyId || template.companyId !== actor.companyId) {
      throw new ForbiddenException('Cannot modify another company template');
    }
  }

  private async assertCompanyExists(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
  }
}
