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
import { RolesGuard } from 'src/shared/guards/role.guard';
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // --- API Lấy Thống kê Tổng quan ---
  @Get('stats')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async getDashboardStats(@Req() req: Request & { user: { sub: string } }) {
    const userId = req.user.sub;
    return this.dashboardService.getDashboardStats(userId);
  }

  // --- Lấy Danh sách ứng viên ---
  @Get('recent-applications')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async getRecentApplications(@Req() req: Request & { user: { sub: string } }) {
    const userId = req.user.sub;
    return this.dashboardService.getRecentApplications(userId);
  }

  @Get('my-jobs')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
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
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async getLeaderboard(
    @Param('jobId') jobId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.dashboardService.getJobLeaderboard(jobId, page, limit);
  }

  @Get('applications/:id')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async getApplicationDetail(@Param('id') id: string) {
    return this.dashboardService.getApplicationDetail(id);
  }
}
