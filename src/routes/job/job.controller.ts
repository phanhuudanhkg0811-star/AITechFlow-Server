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
import { PrismaService } from 'src/shared/services/prisma.service';
import type { CreateJobWithScenarioDto } from './job.dto';
import { JobService } from './job.service';

type RequestWithActor = Request & {
  user: { sub: string; role: string; companyId?: string };
};

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @UseGuards(TenantGuard)
  async getJobs(@Req() req: RequestWithActor) {
    return this.prisma.jobDescription.findMany({
      where:
        req.user.role === 'ADMIN'
          ? undefined
          : { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        scenarios: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        defaultScenario: true,
        emailAccount: { select: { id: true, email: true } },
        _count: {
          select: { applications: true },
        },
      },
    });
  }

  @Post()
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @UseGuards(RolesGuard, TenantGuard)
  async createJobAndScenario(
    @Body() dto: CreateJobWithScenarioDto,
    @Req() req: RequestWithActor,
  ) {
    const result = await this.jobService.createJobAndScenario(
      dto,
      req.user.sub,
    );

    return {
      message: 'Campaign and tests created successfully',
      data: result,
    };
  }

  @Patch(':id')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @TenantScope('job', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  update(
    @Param('id') id: string,
    @Body() dto: CreateJobWithScenarioDto,
    @Req() req: RequestWithActor,
  ) {
    return this.jobService.updateJob(id, req.user.sub, dto);
  }

  @Delete(':id')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @TenantScope('job', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  async remove(@Param('id') id: string, @Req() req: RequestWithActor) {
    await this.jobService.deleteJob(id, req.user.sub);
    return { message: 'Campaign deleted successfully' };
  }
}
