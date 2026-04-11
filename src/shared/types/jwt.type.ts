type Role = 'CANDIDATE' | 'HR' | 'TECH_LEAD';

export interface AccessTokenPayloadCreate {
  sub: string;
  email: string;
  role: Role;
}

export interface AccessTokenPayLoad extends AccessTokenPayloadCreate {
  jti: string;
  exp: number;
  iat: number;
}

export interface RefreshTokenPayloadCreate {
  sub: string;
  email: string;
  role: Role;
}

export interface RefreshTokenPayload extends RefreshTokenPayloadCreate {
  jti: string;
  exp: number;
  iat: number;
}
