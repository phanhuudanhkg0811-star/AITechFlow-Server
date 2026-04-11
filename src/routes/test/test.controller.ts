import {
  Controller,
  Patch,
  Param,
  Body,
  UseGuards,
  Post,
  Get,
  Request,
} from '@nestjs/common';
import { TestService } from './test.service';
import { Roles } from 'src/shared/decorators/role.decorator';
import { RolesGuard } from 'src/shared/guards/role.guard';
import { PrismaService } from 'src/shared/services/prisma.service';
// import { RolesGuard } from '../auth/guards/roles.guard';
// import { Roles } from '../auth/decorators/roles.decorator';

@Controller('tests')
export class TestsController {
  constructor(
    private readonly testsService: TestService,
    private readonly prisma: PrismaService,
  ) {}

  @Patch(':id/rename')
  @UseGuards(RolesGuard)
  @Roles('HR', 'TECH_LEAD') // Chỉ HR/Tech Lead mới được đổi tên đề thi
  async renameTest(
    @Param('id') sessionId: string,
    @Body('title') newTitle: string,
  ) {
    return this.testsService.renameTestScenario(sessionId, newTitle);
  }

  @Post(':id/submit')
  async submitTest(@Param('id') sessionId: string) {
    return this.testsService.submitAndTriggerGrading(sessionId);
  }

  @Get('my-tests')
  // @UseGuards(JwtAuthGuard)
  async getMyApplications(@Request() req) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.id; // Lấy từ token đăng nhập

    const apps = await this.prisma.application.findMany({
      where: { userId: userId },
      select: {
        id: true,
        status: true,
        job: { select: { title: true } },
        testSession: {
          select: {
            id: true,
            scenario: {
              select: {
                title: true,
                difficulty: true,
                timeLimit: true,
                context: true,
              },
            },
          },
        },
      },
      orderBy: { status: 'asc' }, // Ưu tiên xếp TESTING lên đầu
    });

    return apps;
  }
}
