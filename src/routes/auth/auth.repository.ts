import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private prisma: PrismaService) {}

  async deleteRefreshToken(refreshToken: string) {
    return this.prisma.session.delete({
      where: {
        refreshToken,
      },
    });
  }
}
