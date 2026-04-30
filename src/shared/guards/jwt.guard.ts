/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { REQUEST_USER_KEY } from '../constants/auth.contant';
import { JwtAuthService } from '../services/jwt.service';
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly JwtAuthService: JwtAuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // Ưu tiên đọc từ Cookie trước
    let accessToken = request.cookies?.['accessToken'];

    // Fallback: Lỡ như lúc test API trên Postman muốn truyền Header thì vẫn chạy được
    if (!accessToken) {
      const authHeader = request.headers.authorization;
      accessToken =
        typeof authHeader === 'string' ? authHeader.split(' ')[1] : undefined;
    }
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
