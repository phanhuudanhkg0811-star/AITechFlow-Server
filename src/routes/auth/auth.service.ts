import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtAuthService } from 'src/shared/services/jwt.service';
import { PrismaService } from 'src/shared/services/prisma.service';
import { AuthRepository } from './auth.repository';
import { OAuthProfile } from './auth.model';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtAuthService: JwtAuthService,
    private authRepository: AuthRepository,
  ) {}

  async validateOAuthLogin(
    profile: OAuthProfile,
    ipAddress: string,
    userAgent: string,
  ) {
    // 1. TÌM VÀ HỢP NHẤT (RECONCILIATION)
    // Ưu tiên tìm user theo Email (do AI Pipeline tạo ra) hoặc GithubId (nếu đã từng đăng nhập)
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: profile.email }, // Khớp qua email CV
          { githubId: profile.githubId }, // Khớp qua lần đăng nhập trước
        ],
      },
    });

    if (user) {
      // NẾU ĐÃ TỒN TẠI (Được AI quét CV tạo sẵn, hoặc user cũ)
      // -> Cập nhật thêm githubId và avatar để hoàn thiện hồ sơ
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          githubId: profile.githubId,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          githubUsername: profile.githubUsername,
        },
      });
    } else {
      // NẾU CHƯA TỒN TẠI (Ứng viên tự vãng lai đi lạc vào web, không qua gửi CV)
      // -> Bắt buộc tạo mới
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          githubId: profile.githubId,
          githubUsername: profile.githubUsername,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          role: 'CANDIDATE',
        },
      });
    }

    // --- (Phần code sinh Token và tạo Session giữ nguyên như cũ của bạn) ---
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtAuthService.signAccessToken(payload),
      this.jwtAuthService.signRefreshToken(payload),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        userId: user.id, // Vẫn là user.id đó, nên TestSession sẽ được giữ nguyên!
        refreshToken: refreshToken,
        ipAddress: ipAddress,
        userAgent: userAgent,
        expiresAt: expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(
    refreshToken: string,
    ipAddress: string, // Thêm 2 tham số này để lưu Session mới
    userAgent: string,
  ) {
    try {
      // 1. Kiểm tra định dạng và chữ ký token (Verify)
      await this.jwtAuthService.verifyRefreshToken(refreshToken);

      // 2. Xóa token cũ khỏi Database
      const deletedToken =
        await this.authRepository.deleteRefreshToken(refreshToken);

      // 3. Kiểm tra xem token có thực sự tồn tại trong DB trước đó không
      if (!deletedToken) {
        throw new UnauthorizedException(
          'Refresh token không tồn tại hoặc đã bị thu hồi',
        );
      }

      // 4. TRUY XUẤT LẠI USER TỪ DATABASE (Cách an toàn và chuẩn xác nhất)
      const user = await this.prisma.user.findUnique({
        where: { id: deletedToken.userId }, // Dùng userId từ bảng Session để tìm User
      });

      if (!user) {
        throw new UnauthorizedException(
          'Người dùng không còn tồn tại trong hệ thống',
        );
      }

      // 5. Tạo Payload MỚI NHẤT
      const payload = { sub: user.id, email: user.email, role: user.role };

      // 6. Cấp một cặp vé hoàn toàn mới
      const [newAccessToken, newRefreshToken] = await Promise.all([
        this.jwtAuthService.signAccessToken(payload),
        this.jwtAuthService.signRefreshToken(payload),
      ]);

      // 7. Tính ngày hết hạn cho vé mới
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // 8. Lưu phiên làm việc mới vào Database
      await this.prisma.session.create({
        data: {
          userId: user.id,
          refreshToken: newRefreshToken,
          ipAddress: ipAddress,
          userAgent: userAgent,
          expiresAt: expiresAt,
        },
      });

      // 9. Trả về cho Controller
      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (error) {
      console.error('Refresh Token Error:', error);
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại',
      );
    }
  }

  async logout(refreshToken) {
    try {
      await this.authRepository.deleteRefreshToken(refreshToken);
    } catch (error) {
      console.error('Logout Error:', error);
      throw new UnauthorizedException('Đăng xuất không thành công');
    }
  }
}
