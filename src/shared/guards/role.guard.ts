import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUEST_USER_KEY, RoleTypeType } from '../constants/auth.contant';
import { ROLES_KEY } from '../decorators/role.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Lấy danh sách Roles được yêu cầu từ Decorator (vd: ['HR', 'TECH_LEAD'])
    const requiredRoles = this.reflector.getAllAndOverride<RoleTypeType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 2. Nếu API không gắn @Roles() -> Không yêu cầu quyền đặc biệt -> Cho qua
    if (!requiredRoles) {
      return true;
    }

    // 3. Lấy thông tin User từ Request
    // (Lưu ý: User này đã được AccessTokenGuard/AuthenticationGuard giải mã và nhét sẵn vào request từ bước trước)
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const user = request[REQUEST_USER_KEY] as
      | { role: RoleTypeType }
      | undefined;

    // 4. Đề phòng rủi ro: Nếu không có user -> Chặn
    if (!user) {
      throw new ForbiddenException('Chưa xác thực thông tin người dùng');
    }

    // 5. Kiểm tra xem role của user (vd: CANDIDATE) có nằm trong mảng requiredRoles không?
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        'Bạn không có đủ thẩm quyền để truy cập tài nguyên này',
      );
    }

    return true;
  }
}
