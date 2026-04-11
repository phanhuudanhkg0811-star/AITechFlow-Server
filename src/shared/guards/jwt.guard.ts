/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { REQUEST_USER_KEY } from '../constants/auth.contant';
import { JwtAuthService } from '../services/jwt.service';
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly JwtAuthService: JwtAuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const accessToken =
      typeof authHeader === 'string' ? authHeader.split(' ')[1] : undefined;
    if (!accessToken) {
      return false;
    }
    try {
      const decodedAccessToken =
        await this.JwtAuthService.verifyAccessToken(accessToken);
      request[REQUEST_USER_KEY] = decodedAccessToken;
      return true;
    } catch {
      return false;
    }
  }
}
// Dùng cho kiểm tra access token trong request, sử dụng bằng cách thêm decorator @UseGuard(AuthGuard)
