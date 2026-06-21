import { TemplateType } from 'src/generated/prisma/enums';

export interface CreateTemplateDto {
  name: string;
  description?: string;
  templateType: TemplateType;
  initialCode: unknown;
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string | null;
  templateType?: TemplateType;
  initialCode?: unknown;
}
