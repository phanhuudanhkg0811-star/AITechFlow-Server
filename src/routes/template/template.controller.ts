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
import type { CreateTemplateDto, UpdateTemplateDto } from './template.dto';
import { TemplateService } from './template.service';

@Controller()
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post('admin/templates')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  createPublicTemplate(
    @Body() dto: CreateTemplateDto,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.templateService.createPublicTemplate(dto, req.user.sub);
  }

  @Post('companies/:id/templates')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  createPrivateTemplate(
    @Param('id') companyId: string,
    @Body() dto: CreateTemplateDto,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.templateService.createPrivateTemplate(
      companyId,
      dto,
      req.user.sub,
    );
  }

  @Get('templates')
  @UseGuards(TenantGuard)
  listTemplates(
    @Req() req: Request & { user: { role: string; companyId?: string } },
  ) {
    return this.templateService.listTemplates(req.user);
  }

  @Patch('templates/:id')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('template', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Request & { user: { role: string; companyId?: string } },
  ) {
    return this.templateService.updateTemplate(id, dto, req.user);
  }

  @Delete('templates/:id')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('template', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  deleteTemplate(
    @Param('id') id: string,
    @Req() req: Request & { user: { role: string; companyId?: string } },
  ) {
    return this.templateService.deleteTemplate(id, req.user);
  }
}
