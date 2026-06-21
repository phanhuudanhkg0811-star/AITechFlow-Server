import { config } from 'dotenv';
import z from 'zod';

config({ path: '.env' });

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_CLIENT_URL: z.string().min(1),
  GITHUB_CLIENT_CALLBACK_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(1),
  ACCESS_TOKEN_EXPIRES_IN: z.string().min(1),
  REFRESH_TOKEN_SECRET: z.string().min(1),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(1),
  SECRET_API_KEY: z.string().min(1),
  ENCRYPTION_MASTER_KEY: z.string().min(32),
  IMAP_HOST: z.string().default('imap.gmail.com'),
  IMAP_PORT: z.coerce.number().default(993),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  EMAIL_FROM: z.string(),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
});

const configServer = configSchema.safeParse(process.env);

if (!configServer.success) {
  console.error(
    'Invalid environment variables:',
    configServer.error.flatten().fieldErrors,
  );
  process.exit(1);
}

const envConfig = configServer.data;

console.log('Environment variables loaded successfully.');

export default envConfig;
