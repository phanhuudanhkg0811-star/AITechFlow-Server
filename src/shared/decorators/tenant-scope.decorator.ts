import { SetMetadata } from '@nestjs/common';

export const TENANT_SCOPE_KEY = 'tenantScope';

export type TenantResource =
  | 'company'
  | 'user'
  | 'emailAccount'
  | 'job'
  | 'application'
  | 'template';

export interface TenantScopePayload {
  resource: TenantResource;
  param: string;
}

export const TenantScope = (
  resource: TenantResource,
  param = 'id',
): ReturnType<typeof SetMetadata> =>
  SetMetadata(TENANT_SCOPE_KEY, {
    resource,
    param,
  } satisfies TenantScopePayload);
