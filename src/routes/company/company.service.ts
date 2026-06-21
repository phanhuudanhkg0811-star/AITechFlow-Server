import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
import {
  CreateCompanyDto,
  CreateHrDto,
  UpdateCompanyApiKeyDto,
  UpdateCompanyDto,
  UpdateHrDto,
} from './company.dto';
import { CryptoService } from 'src/shared/services/crypto.service';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async createCompany(dto: CreateCompanyDto) {
    this.assertName(dto.name);

    const company = await this.prisma.company.create({
      data: { name: dto.name.trim() },
    });

    if (dto.rootEmail) {
      await this.prisma.user.upsert({
        where: { email: dto.rootEmail.toLowerCase().trim() },
        update: {
          name: dto.rootName,
          role: 'COMPANY_ROOT',
          companyId: company.id,
        },
        create: {
          email: dto.rootEmail.toLowerCase().trim(),
          name: dto.rootName,
          role: 'COMPANY_ROOT',
          companyId: company.id,
        },
      });
    }

    return this.getCompany(company.id);
  }

  listCompanies() {
    return this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenUsage: true,
        aiSuggestionEnabled: true,
        createdAt: true,
        updatedAt: true,
        apiKey: false,
        _count: {
          select: {
            users: true,
            jobs: true,
            emailAccounts: true,
            templates: true,
          },
        },
      },
    });
  }

  async getCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        tokenUsage: true,
        aiSuggestionEnabled: true,
        createdAt: true,
        updatedAt: true,
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            githubUsername: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        apiKey: false,
        _count: {
          select: {
            jobs: true,
            emailAccounts: true,
            templates: true,
          },
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  async updateCompany(id: string, dto: UpdateCompanyDto) {
    const data: UpdateCompanyDto = {};

    if (dto.name !== undefined) {
      this.assertName(dto.name);
      data.name = dto.name.trim();
    }

    if (dto.aiSuggestionEnabled !== undefined) {
      data.aiSuggestionEnabled = dto.aiSuggestionEnabled;
    }

    return this.prisma.company.update({
      where: { id },
      data,
    });
  }

  async updateApiKey(id: string, dto: UpdateCompanyApiKeyDto) {
    if (!dto.apiKey?.trim()) {
      throw new BadRequestException('API key is required');
    }

    await this.assertCompanyExists(id);

    await this.prisma.company.update({
      where: { id },
      data: { apiKey: this.cryptoService.encrypt(dto.apiKey.trim()) },
    });

    return { success: true, hasApiKey: true };
  }

  async getApiKeyStatus(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        apiKey: true,
        tokenUsage: true,
        aiSuggestionEnabled: true,
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    return {
      id: company.id,
      name: company.name,
      hasApiKey: Boolean(company.apiKey),
      tokenUsage: company.tokenUsage,
      aiSuggestionEnabled: company.aiSuggestionEnabled,
    };
  }

  async deleteCompany(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');

    await this.prisma.user.updateMany({
      where: { companyId: id },
      data: { companyId: null, role: 'CANDIDATE' },
    });

    return this.prisma.company.delete({ where: { id } });
  }

  async createHr(companyId: string, dto: CreateHrDto) {
    this.assertEmail(dto.email);

    await this.assertCompanyExists(companyId);

    return this.prisma.user.upsert({
      where: { email: dto.email.toLowerCase().trim() },
      update: {
        name: dto.name,
        githubUsername: dto.githubUsername,
        role: 'HR',
        companyId,
      },
      create: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name,
        githubUsername: dto.githubUsername,
        role: 'HR',
        companyId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        githubUsername: true,
        createdAt: true,
      },
    });
  }

  async listHr(companyId: string) {
    await this.assertCompanyExists(companyId);

    return this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['HR', 'COMPANY_ROOT'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        githubUsername: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateHr(id: string, dto: UpdateHrDto, actorCompanyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, companyId: true },
    });

    if (!user) throw new NotFoundException('HR user not found');

    if (actorCompanyId && user.companyId !== actorCompanyId) {
      throw new ForbiddenException('Cannot update HR from another company');
    }

    if (user.role !== 'HR' && user.role !== 'COMPANY_ROOT') {
      throw new BadRequestException('Target user is not an HR/company user');
    }

    if (dto.deactivate) {
      return this.prisma.user.update({
        where: { id },
        data: {
          role: 'CANDIDATE',
          companyId: null,
        },
        select: this.hrSelect(),
      });
    }

    if (dto.role && !['COMPANY_ROOT', 'HR', 'CANDIDATE'].includes(dto.role)) {
      throw new BadRequestException('Invalid role for HR management');
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        githubUsername: dto.githubUsername,
        role: dto.role,
      },
      select: this.hrSelect(),
    });
  }

  private async assertCompanyExists(id: string) {
    const exists = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) throw new NotFoundException('Company not found');
  }

  private assertName(name?: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Company name is required');
    }
  }

  private assertEmail(email?: string) {
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
  }

  private hrSelect() {
    return {
      id: true,
      email: true,
      name: true,
      role: true,
      companyId: true,
      githubUsername: true,
      avatarUrl: true,
      updatedAt: true,
    } as const;
  }
}
