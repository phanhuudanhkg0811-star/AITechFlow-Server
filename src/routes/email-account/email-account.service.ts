import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import envConfig from 'src/shared/config';
import { CryptoService } from 'src/shared/services/crypto.service';
import { PrismaService } from 'src/shared/services/prisma.service';
import {
  CreateEmailAccountDto,
  UpdateEmailAccountDto,
} from './email-account.dto';

@Injectable()
export class EmailAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(
    dto: CreateEmailAccountDto,
    actor: { sub: string; role: string; companyId?: string },
  ) {
    this.assertEmail(dto.email);
    this.assertPassword(dto.password);

    const companyId = this.resolveCompanyId(dto.companyId, actor);

    await this.assertCompanyExists(companyId);

    return this.prisma.emailAccount.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        encryptedPassword: this.cryptoService.encrypt(dto.password),
        userId: actor.sub,
        companyId,
      },
      select: this.publicSelect(),
    });
  }

  async list(actor: { role: string; companyId?: string }) {
    const where =
      actor.role === 'ADMIN'
        ? undefined
        : {
            companyId: actor.companyId,
          };

    return this.prisma.emailAccount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    });
  }

  async update(id: string, dto: UpdateEmailAccountDto) {
    const existing = await this.prisma.emailAccount.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) throw new NotFoundException('Email account not found');

    if (dto.email !== undefined) this.assertEmail(dto.email);
    if (dto.password !== undefined) this.assertPassword(dto.password);

    return this.prisma.emailAccount.update({
      where: { id },
      data: {
        email: dto.email?.toLowerCase().trim(),
        encryptedPassword:
          dto.password !== undefined
            ? this.cryptoService.encrypt(dto.password)
            : undefined,
        isActive: dto.isActive,
      },
      select: this.publicSelect(),
    });
  }

  async softDelete(id: string) {
    await this.assertEmailAccountExists(id);

    return this.prisma.emailAccount.update({
      where: { id },
      data: { isActive: false },
      select: this.publicSelect(),
    });
  }

  async testConnection(id: string) {
    const account = await this.prisma.emailAccount.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        encryptedPassword: true,
      },
    });

    if (!account) throw new NotFoundException('Email account not found');

    if (!account.encryptedPassword) {
      throw new BadRequestException(
        'Email account does not have an encrypted password',
      );
    }

    const client = new ImapFlow({
      host: envConfig.IMAP_HOST,
      port: envConfig.IMAP_PORT,
      secure: true,
      auth: {
        user: account.email,
        pass: this.cryptoService.decrypt(account.encryptedPassword),
      },
      logger: false,
      socketTimeout: 15000,
      connectionTimeout: 15000,
    });

    try {
      await client.connect();
      await client.logout();

      await this.prisma.emailAccount.update({
        where: { id },
        data: { lastUsed: new Date() },
      });

      return { success: true };
    } catch (error) {
      await client
        .logout()
        .catch(() => undefined);

      const message =
        error instanceof Error ? error.message : 'IMAP connection failed';
      return { success: false, message };
    }
  }

  private resolveCompanyId(
    requestedCompanyId: string | undefined,
    actor: { role: string; companyId?: string },
  ) {
    if (actor.role === 'ADMIN') {
      if (!requestedCompanyId) {
        throw new BadRequestException('companyId is required for ADMIN');
      }

      return requestedCompanyId;
    }

    if (!actor.companyId) {
      throw new ForbiddenException('User is not assigned to a company');
    }

    if (requestedCompanyId && requestedCompanyId !== actor.companyId) {
      throw new ForbiddenException('Cannot create email account for another company');
    }

    return actor.companyId;
  }

  private async assertCompanyExists(id: string) {
    const exists = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) throw new NotFoundException('Company not found');
  }

  private async assertEmailAccountExists(id: string) {
    const exists = await this.prisma.emailAccount.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) throw new NotFoundException('Email account not found');
  }

  private assertEmail(email?: string) {
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
  }

  private assertPassword(password?: string) {
    if (!password?.trim()) {
      throw new BadRequestException('Password is required');
    }
  }

  private publicSelect() {
    return {
      id: true,
      email: true,
      userId: true,
      companyId: true,
      isActive: true,
      lastUsed: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
