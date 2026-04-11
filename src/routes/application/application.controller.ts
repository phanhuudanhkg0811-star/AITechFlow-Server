import { Controller, Get, Request } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
// Lưu ý: Không cần khai báo @UseGuards vì AuthenticationGuard của ông
// đã được cấu hình "Secure by default" (khóa mặc định bằng Bearer Token) rồi!

@Controller('application')
export class ApplicationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('my-tests')
  async getMyApplications(@Request() req) {
    // ID của user thường nằm trong trường 'sub' của payload JWT
    const userId = req.user.sub;

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
      orderBy: { status: 'asc' }, // Ưu tiên những bài đang ở trạng thái TESTING lên đầu
    });

    return apps;
  }
}
