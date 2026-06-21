import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Request } from 'express';
import { DashboardService } from './dashboard.service';
import { Roles } from 'src/shared/decorators/role.decorator';
import { TenantScope } from 'src/shared/decorators/tenant-scope.decorator';
import { RolesGuard } from 'src/shared/guards/role.guard';
import { TenantGuard } from 'src/shared/guards/tenant.guard';
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // --- API Lấy Thống kê Tổng quan ---
  @Get('stats')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @UseGuards(RolesGuard, TenantGuard)
  async getDashboardStats(@Req() req: Request & { user: { sub: string } }) {
    const userId = req.user.sub;
    return this.dashboardService.getDashboardStats(userId);
  }

  // --- Lấy Danh sách ứng viên ---
  @Get('recent-applications')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @UseGuards(RolesGuard, TenantGuard)
  async getRecentApplications(@Req() req: Request & { user: { sub: string } }) {
    const userId = req.user.sub;
    return this.dashboardService.getRecentApplications(userId);
  }

  @Get('my-jobs')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @UseGuards(RolesGuard, TenantGuard)
  async getMyJobs(
    @Req() req: Request & { user: { sub: string } },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const userId = req.user.sub;
    console.log(
      `DashboardController.getMyJobs: HR id = ${userId}, page = ${page}, limit = ${limit}`,
    );
    return this.dashboardService.getHrJobs(userId, page, limit);
  }

  @Get('jobs/:jobId/leaderboard')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @TenantScope('job', 'jobId')
  @UseGuards(RolesGuard, TenantGuard)
  async getLeaderboard(
    @Param('jobId') jobId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.dashboardService.getJobLeaderboard(jobId, page, limit);
  }

  @Get('applications/:id')
  @Roles('HR', 'COMPANY_ROOT', 'ADMIN')
  @TenantScope('application', 'id')
  @UseGuards(RolesGuard, TenantGuard)
  async getApplicationDetail(@Param('id') id: string) {
    return this.dashboardService.getApplicationDetail(id);
  }
}
