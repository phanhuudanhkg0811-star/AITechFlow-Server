import { Controller, Get, Ip, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express'; // <-- Thêm chữ 'type' ở đây
import { AuthGuard } from '@nestjs/passport';
import { OAuthProfile } from './auth.model';
import { AuthService } from './auth.service';
import { IsPublic } from 'src/shared/decorators/auth.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Kích hoạt luồng đăng nhập GitHub
  @Get('github')
  @IsPublic()
  @UseGuards(AuthGuard('github'))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async githubAuth(@Req() req) {
    // Passport tự động chuyển hướng sang trang đăng nhập của GitHub
  }

  // Hứng dữ liệu từ GitHub trả về
  @Get('github/callback')
  @IsPublic()
  @UseGuards(AuthGuard('github'))
  async githubAuthRedirect(
    @Req() req: Request & { user?: OAuthProfile },
    @Res() res: Response,
    @Ip() ipAddress: string,
  ) {
    const profile = req.user;

    if (profile == undefined) {
      return res.status(401).send('Unauthorized');
    }
    const userAgent = req.get('user-agent') || 'Unknown';

    const { accessToken, refreshToken } =
      await this.authService.validateOAuthLogin(profile, ipAddress, userAgent);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, // Cực kỳ quan trọng: JS Frontend không thể đọc được
      secure: process.env.NODE_ENV === 'production', // Bắt buộc dùng HTTPS khi deploy thật, chạy local (http) thì để false
      sameSite: 'lax', // Khuyên dùng 'lax' để chống tấn công CSRF mà vẫn mượt mà khi redirect
      maxAge: 7 * 24 * 60 * 60 * 1000, // Tuổi thọ của cookie
      path: '/', // Cookie có hiệu lực trên toàn bộ domain
    });

    return res.redirect(
      `${process.env.GITHUB_CLIENT_URL}/login/success?accessToken=${accessToken}`,
    );
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const refreshToken = req.cookies['refreshToken'];

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return res
      .status(200)
      .json({ message: 'Đăng xuất thành công, đã hủy token!' });
  }
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ipAddress: string,
  ) {
    const refreshTokenCookie = req.cookies['refreshToken'] as string;

    if (!refreshTokenCookie) {
      return res.status(401).json({ message: 'Refresh token not found' });
    }

    const userAgent = req.get('user-agent') || 'Unknown';

    const { accessToken, refreshToken } = await this.authService.refresh(
      refreshTokenCookie,
      ipAddress,
      userAgent,
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({ accessToken });
  }
}
