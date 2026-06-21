import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from 'src/shared/decorators/role.decorator';
import { TenantScope } from 'src/shared/decorators/tenant-scope.decorator';
import { RolesGuard } from 'src/shared/guards/role.guard';
import { TenantGuard } from 'src/shared/guards/tenant.guard';
import type {
  CreateEmailAccountDto,
  UpdateEmailAccountDto,
} from './email-account.dto';
import { EmailAccountService } from './email-account.service';
import { AiPipelineService } from '../ai/ai-pineline.service';

@Controller('email-accounts')
@Roles('HR', 'COMPANY_ROOT', 'ADMIN')
@UseGuards(RolesGuard, TenantGuard)
export class EmailAccountController {
  constructor(
    private readonly emailAccountService: EmailAccountService,
    private readonly aiPipelineService: AiPipelineService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateEmailAccountDto,
    @Req()
    req: Request & {
      user: { sub: string; role: string; companyId?: string };
    },
  ) {
    return this.emailAccountService.create(dto, req.user);
  }

  @Get()
  list(
    @Req()
    req: Request & {
      user: { role: string; companyId?: string };
    },
  ) {
    return this.emailAccountService.list(req.user);
  }

  @Patch(':id')
  @TenantScope('emailAccount', 'id')
  update(@Param('id') id: string, @Body() dto: UpdateEmailAccountDto) {
    return this.emailAccountService.update(id, dto);
  }

  @Delete(':id')
  @TenantScope('emailAccount', 'id')
  remove(@Param('id') id: string) {
    return this.emailAccountService.softDelete(id);
  }

  @Post(':id/test')
  @TenantScope('emailAccount', 'id')
  testConnection(@Param('id') id: string) {
    return this.emailAccountService.testConnection(id);
  }

  @Post(':id/sync')
  @TenantScope('emailAccount', 'id')
  sync(@Param('id') id: string) {
    return this.aiPipelineService.processSingleAccount(id);
  }
}
