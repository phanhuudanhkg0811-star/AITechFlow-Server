import { z } from 'zod';

export enum difficultyEnum {
  INTERN = 'Intern',
  JUNIOR = 'Junior',
  MID_LEVEL = 'Mid-level',
  SENIOR = 'Senior',
}

export const createJobWithScenarioSchema = z.object({
  title: z.string().min(5, 'Campaign title must be at least 5 characters'),
  content: z.string().min(50, 'Job description must be at least 50 characters'),
  hrEmail: z.string().email('Invalid email format').optional(),
  emailAccountId: z.string().uuid().optional(),
  jobReference: z.string().trim().min(1).optional(),
  scenarioTitle: z.string().min(5, 'Test title is too short').optional(),
  difficulty: z
    .enum([
      difficultyEnum.INTERN,
      difficultyEnum.JUNIOR,
      difficultyEnum.MID_LEVEL,
      difficultyEnum.SENIOR,
    ])
    .optional(),
  timeLimit: z
    .number()
    .int()
    .min(10, 'Minimum time limit is 10 minutes')
    .optional(),
  scenarioContext: z
    .string()
    .min(10, 'Scenario context is required')
    .optional(),
  scenarios: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(5, 'Test title is too short'),
        difficulty: z.enum([
          difficultyEnum.INTERN,
          difficultyEnum.JUNIOR,
          difficultyEnum.MID_LEVEL,
          difficultyEnum.SENIOR,
        ]),
        timeLimit: z.number().int().min(10).default(90),
        context: z.string().min(10, 'Scenario context is required'),
        templateId: z.string().uuid().optional(),
        initialCode: z.unknown().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .optional(),
});

export type CreateJobWithScenarioDto = z.infer<
  typeof createJobWithScenarioSchema
>;
