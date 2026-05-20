/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  Delete,
  Patch,
  Param,
} from '@nestjs/common';
import { Request } from 'express';
import { JobService } from './job.service';
import type { CreateJobWithScenarioDto } from './job.dto';
import { PrismaService } from 'src/shared/services/prisma.service';
import { Roles } from 'src/shared/decorators/role.decorator';
import { RolesGuard } from 'src/shared/guards/role.guard';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
  ) {}

  // API lấy tất cả Job (Có thể public hoặc chặn tùy bạn)
  @Get()
  async getJobs() {
    return this.prisma.jobDescription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { applications: true }, // Đếm số lượng hồ sơ để hiện lên UI
        },
      },
    });
  }

  // API tạo Job (Chỉ HR hoặc TECH_LEAD mới được tạo)
  @Post()
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async createJobAndScenario(
    @Body() dto: CreateJobWithScenarioDto,
    // TypeScript khai báo kiểu để lấy req.user.sub (ID của user)
    @Req() req: Request & { user: { sub: string } },
  ) {
    // 1. Lấy ID của HR đang đăng nhập từ payload của JWT
    const creatorId = req.user.sub;

    // 2. Chuyển DTO và creatorId sang Service xử lý (Bao gồm lưu DB và gọi AI)
    const result = await this.jobService.createJobAndScenario(dto, creatorId);

    // 3. Trả về kết quả
    return {
      message: 'Tạo chiến dịch và đề thi thành công!',
      data: result,
    };
  }
  @Patch(':id')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: CreateJobWithScenarioDto,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.jobService.updateJob(id, req.user.sub, dto);
  }

  @Delete(':id')
  @Roles('HR', 'TECH_LEAD')
  @UseGuards(RolesGuard)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.jobService.deleteJob(id, req.user.sub);
    return { message: 'Xóa chiến dịch thành công' };
  }
}
