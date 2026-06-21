export interface CreateEmailAccountDto {
  email: string;
  password: string;
  companyId?: string;
}

export interface UpdateEmailAccountDto {
  email?: string;
  password?: string;
  isActive?: boolean;
}
