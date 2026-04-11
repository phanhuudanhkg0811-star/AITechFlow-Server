import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import envConfig from '../config';
import {
  AccessTokenPayLoad,
  AccessTokenPayloadCreate,
  RefreshTokenPayload,
  RefreshTokenPayloadCreate,
} from '../types/jwt.type';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class JwtAuthService {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * Generates a pair of access and refresh tokens.
   * @param userId The user's ID.
   * @param email The user's email.
   * @returns A promise that resolves to an object with accessToken and refreshToken.
   */
  // async generateTokens(userId: number, email: string) {
  //   const payload = { sub: userId, email };
  //   const [accessToken, refreshToken] = await Promise.all([
  //     this.jwtService.signAsync(payload, {
  //       secret: envConfig.ACCESS_TOKEN_SECRET,
  //       expiresIn: envConfig.ACCESS_TOKEN_EXPIRES_IN as any,
  //     }),
  //     this.jwtService.signAsync(payload, {
  //       secret: envConfig.REFRESH_TOKEN_SECRET,
  //       expiresIn: envConfig.REFRESH_TOKEN_EXPIRES_IN as any,
  //     }),
  //   ]);

  //   return {
  //     accessToken,
  //     refreshToken,
  //   };
  // }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync(token, {
      secret: envConfig.REFRESH_TOKEN_SECRET,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayLoad> {
    return this.jwtService.verifyAsync(token, {
      secret: envConfig.ACCESS_TOKEN_SECRET,
    });
  }

  async signRefreshToken(payload: RefreshTokenPayloadCreate) {
    return this.jwtService.signAsync(
      { ...payload, jti: uuidv4() },
      {
        secret: envConfig.REFRESH_TOKEN_SECRET,
        expiresIn: envConfig.REFRESH_TOKEN_EXPIRES_IN as any,
      },
    );
  }

  async signAccessToken(payload: AccessTokenPayloadCreate) {
    return this.jwtService.signAsync(
      { ...payload, jti: uuidv4() },
      {
        secret: envConfig.ACCESS_TOKEN_SECRET,
        expiresIn: envConfig.ACCESS_TOKEN_EXPIRES_IN as any,
      },
    );
  }
}
