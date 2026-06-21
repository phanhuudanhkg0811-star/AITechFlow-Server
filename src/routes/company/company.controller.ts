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
import { Roles } from 'src/shared/decorators/role.decorator';
import { TenantScope } from 'src/shared/decorators/tenant-scope.decorator';
import { REQUEST_USER_KEY } from 'src/shared/constants/auth.contant';
import { RolesGuard } from 'src/shared/guards/role.guard';
import { TenantGuard } from 'src/shared/guards/tenant.guard';
import type {
  CreateCompanyDto,
  CreateHrDto,
  UpdateCompanyApiKeyDto,
  UpdateCompanyDto,
  UpdateHrDto,
} from './company.dto';
import { CompanyService } from './company.service';

@Controller()
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post('admin/companies')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.companyService.createCompany(dto);
  }

  @Get('admin/companies')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  listCompanies() {
    return this.companyService.listCompanies();
  }

  @Get('admin/companies/:id')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  getCompany(@Param('id') id: string) {
    return this.companyService.getCompany(id);
  }

  @Patch('admin/companies/:id')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  updateCompany(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companyService.updateCompany(id, dto);
  }

  @Patch('companies/:id/settings')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  updateCompanySettings(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.updateCompany(id, dto);
  }

  @Delete('admin/companies/:id')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  deleteCompany(@Param('id') id: string) {
    return this.companyService.deleteCompany(id);
  }

  @Patch('companies/:id/api-key')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  updateApiKey(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyApiKeyDto,
  ) {
    return this.companyService.updateApiKey(id, dto);
  }

  @Get('companies/:id/api-key')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  getApiKeyStatus(@Param('id') id: string) {
    return this.companyService.getApiKeyStatus(id);
  }

  @Post('companies/:id/hr')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  createHr(@Param('id') companyId: string, @Body() dto: CreateHrDto) {
    return this.companyService.createHr(companyId, dto);
  }

  @Get('companies/:id/hr')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('company', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  listHr(@Param('id') companyId: string) {
    return this.companyService.listHr(companyId);
  }

  @Patch('hr/:id')
  @Roles('COMPANY_ROOT', 'ADMIN')
  @TenantScope('user', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  updateHr(
    @Param('id') id: string,
    @Body() dto: UpdateHrDto,
    @Req()
    req: {
      [REQUEST_USER_KEY]: {
        role: string;
        companyId?: string;
      };
    },
  ) {
    const actor = req[REQUEST_USER_KEY];
    const actorCompanyId = actor.role === 'ADMIN' ? undefined : actor.companyId;

    return this.companyService.updateHr(id, dto, actorCompanyId);
  }
}
