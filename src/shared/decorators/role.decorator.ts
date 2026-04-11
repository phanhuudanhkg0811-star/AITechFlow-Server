import { SetMetadata } from '@nestjs/common';
import { RoleTypeType } from '../constants/auth.contant';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: RoleTypeType[]) =>
  SetMetadata(ROLES_KEY, roles);
