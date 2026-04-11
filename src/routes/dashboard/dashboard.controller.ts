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
}
