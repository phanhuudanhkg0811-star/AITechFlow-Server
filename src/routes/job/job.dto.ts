import { z } from 'zod';

export enum difficultyEnum {
  INTERN = 'Intern',
  JUNIOR = 'Junior',
  MID_LEVEL = 'Mid-level',
  SENIOR = 'Senior',
}

export const createJobWithScenarioSchema = z.object({
  title: z.string().min(5, 'Tiêu đề chiến dịch phải có ít nhất 5 ký tự'),
  content: z.string().min(50, 'Nội dung JD cần ít nhất 50 ký tự'),
  hrEmail: z.string().email('Định dạng email không hợp lệ').optional(),

  // --- Thông tin đính kèm cho bài Test ---
  scenarioTitle: z.string().min(5, 'Tiêu đề bài thi quá ngắn'),
  difficulty: z.enum([
    difficultyEnum.INTERN,
    difficultyEnum.JUNIOR,
    difficultyEnum.MID_LEVEL,
    difficultyEnum.SENIOR,
  ]),
  timeLimit: z.number().int().min(10, 'Thời gian làm bài tối thiểu là 10 phút'),
  scenarioContext: z.string().min(10, 'Bối cảnh (Context) không được để trống'),
});

export type CreateJobWithScenarioDto = z.infer<
  typeof createJobWithScenarioSchema
>;
