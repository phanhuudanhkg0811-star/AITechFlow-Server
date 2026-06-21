/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUEST_USER_KEY } from '../constants/auth.contant';
import {
  TENANT_SCOPE_KEY,
  TenantScopePayload,
} from '../decorators/tenant-scope.decorator';
import { PrismaService } from '../services/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
      [REQUEST_USER_KEY]?: {
        id?: string;
        sub: string;
        role: string;
        companyId?: string;
      };
    }>();

    const tokenUser = request[REQUEST_USER_KEY];
    if (!tokenUser?.sub) {
      throw new ForbiddenException('User is not authenticated');
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: tokenUser.sub },
      select: { id: true, role: true, companyId: true },
    });

    if (!currentUser) {
      throw new ForbiddenException('User no longer exists');
    }

    request[REQUEST_USER_KEY] = {
      ...tokenUser,
      id: currentUser.id,
      role: currentUser.role,
      companyId: currentUser.companyId ?? undefined,
    };

    if (currentUser.role === 'ADMIN') {
      return true;
    }

    if (!currentUser.companyId) {
      throw new ForbiddenException('User is not assigned to a company');
    }

    const tenantScope = this.reflector.getAllAndOverride<
      TenantScopePayload | undefined
    >(TENANT_SCOPE_KEY, [context.getHandler(), context.getClass()]);

    if (!tenantScope) {
      return this.ensureExplicitCompanyMatchesRequest(
        currentUser.companyId,
        request.body,
        request.query,
      );
    }

    const targetId = request.params?.[tenantScope.param];
    if (!targetId) {
      throw new ForbiddenException('Tenant resource id is missing');
    }

    const targetCompanyId = await this.resolveTargetCompanyId(
      tenantScope.resource,
      targetId,
    );

    if (!targetCompanyId || targetCompanyId !== currentUser.companyId) {
      throw new ForbiddenException('You cannot access another company tenant');
    }

    return true;
  }

  private ensureExplicitCompanyMatchesRequest(
    companyId: string,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ) {
    const requestedCompanyId = body?.companyId ?? query?.companyId;

    if (requestedCompanyId && requestedCompanyId !== companyId) {
      throw new ForbiddenException('You cannot access another company tenant');
    }

    return true;
  }

  private async resolveTargetCompanyId(resource: string, id: string) {
    switch (resource) {
      case 'company':
        return id;
      case 'user': {
        const user = await this.prisma.user.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return user?.companyId;
      }
      case 'emailAccount': {
        const emailAccount = await this.prisma.emailAccount.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return emailAccount?.companyId;
      }
      case 'job': {
        const job = await this.prisma.jobDescription.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return job?.companyId;
      }
      case 'application': {
        const application = await this.prisma.application.findUnique({
          where: { id },
          select: { job: { select: { companyId: true } } },
        });
        return application?.job.companyId;
      }
      case 'template': {
        const template = await this.prisma.template.findUnique({
          where: { id },
          select: { companyId: true, isPublic: true },
        });
        return template?.isPublic ? null : template?.companyId;
      }
      default:
        return null;
    }
  }
}
