/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Controller, Get, Request } from '@nestjs/common';
import { ApplicationService } from './application.service';
// Lưu ý: Không cần khai báo @UseGuards vì AuthenticationGuard của ông
// đã được cấu hình "Secure by default" (khóa mặc định bằng Bearer Token) rồi!

@Controller('application')
export class ApplicationController {
  constructor(private applicationService: ApplicationService) {}

  @Get('my-tests')
  async getMyApplications(@Request() req) {
    // ID của user thường nằm trong trường 'sub' của payload JWT
    const userId = req.user.sub;

    const apps = await this.applicationService.getApplicationsByUserId(userId);
    return apps;
  }
}
