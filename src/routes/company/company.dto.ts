export interface CreateCompanyDto {
  name: string;
  rootEmail?: string;
  rootName?: string;
}

export interface UpdateCompanyDto {
  name?: string;
  aiSuggestionEnabled?: boolean;
}

export interface UpdateCompanyApiKeyDto {
  apiKey: string;
}

export interface CreateHrDto {
  email: string;
  name?: string;
  githubUsername?: string;
}

export interface UpdateHrDto {
  name?: string;
  githubUsername?: string;
  role?: 'COMPANY_ROOT' | 'HR' | 'CANDIDATE';
  deactivate?: boolean;
}
