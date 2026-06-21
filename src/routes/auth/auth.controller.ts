import { Controller, Get, Ip, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { OAuthProfile } from './auth.model';
import { AuthService } from './auth.service';
import { IsPublic } from 'src/shared/decorators/auth.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  //endpoint /auth/github
  @Get('github')
  @IsPublic()
  @UseGuards(AuthGuard('github'))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async githubAuth(@Req() req) {
    // Passport tự động chuyển hướng
  }

  @Get('github/callback')
  @IsPublic()
  @UseGuards(AuthGuard('github'))
  async githubAuthRedirect(
    @Req() req: Request & { user?: OAuthProfile },
    @Res() res: Response,
    @Ip() ipAddress: string,
  ) {
    const profile = req.user;
    if (!profile) return res.status(401).send('Unauthorized');

    const userAgent = req.get('user-agent') || 'Unknown';
    const { accessToken, refreshToken } =
      await this.authService.validateOAuthLogin(profile, ipAddress, userAgent);

    // Cấu hình chung cho Cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    // Set Refresh Token (sống lâu)
    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    });

    // Set Access Token (sống ngắn)
    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 phút (khớp với ACCESS_TOKEN_EXPIRES_IN trong .env)
    });

    // Chuyển hướng thẳng về Frontend, KHÔNG cần query param nữa
    return res.redirect(`${process.env.GITHUB_CLIENT_URL}/login/success`);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const refreshToken = req.cookies['refreshToken'];

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    // Xóa cả 2 cookie
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('accessToken', cookieOptions);

    return res
      .status(200)
      .json({ message: 'Đăng xuất thành công, đã hủy token!' });
  }

  @Post('refresh')
  @IsPublic()
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

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    // Set lại cả 2 Cookie mới
    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });

    return res.json({ message: 'Làm mới token thành công' }); // Không trả token về body nữa
  }

  @Get('me')
  async getMe(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.getMe(req.user.sub);
  }
}
