import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from 'src/shared/services/prisma.service';

export type OAuthProfile = {
  email: string;
  githubId: string;
  githubUsername: string;
  name: string;
  avatarUrl: string;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateOAuthLogin(
    profile: OAuthProfile,
    ipAddress: string,
    userAgent: string,
  ) {
    // 1. Tìm hoặc tạo mới User dựa trên githubId (Upsert)
    const user = await this.prisma.user.upsert({
      where: { githubId: profile.githubId },
      update: {
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        githubUsername: profile.githubUsername,
      },
      create: {
        email: profile.email,
        githubId: profile.githubId,
        githubUsername: profile.githubUsername,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role: 'CANDIDATE', // Mặc định là ứng viên
      },
    });

    // 2. Tạo Access Token (JWT)
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' }); // Sống 15 phút

    // 3. Tạo Refresh Token (Chuỗi ngẫu nhiên an toàn)
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Sống 7 ngày

    // 4. Lưu Refresh Token vào bảng Session
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshToken: refreshToken, // Trong thực tế có thể hash bằng bcrypt trước khi lưu
        ipAddress: ipAddress,
        userAgent: userAgent,
        expiresAt: expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
