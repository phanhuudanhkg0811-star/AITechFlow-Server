import { Controller, Get, Ip, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express'; // <-- Thêm chữ 'type' ở đây
import { AuthService, OAuthProfile } from './auth.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Kích hoạt luồng đăng nhập GitHub
  @Get('github')
  @UseGuards(AuthGuard('github'))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async githubAuth(@Req() req) {
    // Passport tự động chuyển hướng sang trang đăng nhập của GitHub
  }

  // Hứng dữ liệu từ GitHub trả về
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthRedirect(
    @Req() req: Request & { user?: OAuthProfile },
    @Res() res: Response,
    @Ip() ipAddress: string,
  ) {
    // req.user chứa profile từ file GithubStrategy truyền sang
    const profile = req.user;

    if (profile == undefined) {
      return res.status(401).send('Unauthorized');
    }

    // Lấy thông tin thiết bị
    const userAgent = req.get('user-agent') || 'Unknown';

    // Xử lý logic database và cấp token
    const { accessToken, refreshToken } =
      await this.authService.validateOAuthLogin(profile, ipAddress, userAgent);

    // 2. Kẹp Refresh Token vào HttpOnly Cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, // Cực kỳ quan trọng: JS Frontend không thể đọc được
      secure: process.env.NODE_ENV === 'production', // Bắt buộc dùng HTTPS khi deploy thật, chạy local (http) thì để false
      sameSite: 'lax', // Khuyên dùng 'lax' để chống tấn công CSRF mà vẫn mượt mà khi redirect
      maxAge: 7 * 24 * 60 * 60 * 1000, // Tuổi thọ của cookie (Ví dụ: 7 ngày tính bằng mili-giây)
      path: '/', // Cookie có hiệu lực trên toàn bộ domain
    });
    // Redirect về Frontend Next.js kèm theo token
    return res.redirect(
      `${process.env.GITHUB_CLIENT_URL}/login/success?accessToken=${accessToken}`,
    );
  }
}
