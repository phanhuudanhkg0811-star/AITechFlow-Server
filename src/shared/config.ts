import { config } from 'dotenv';
import z from 'zod';
import fs from 'fs';
import path from 'path';

// 1. Load file .env
config({
  path: '.env',
});

// 2. Kiểm tra file tồn tại (Dùng đúng tên file .env)
if (!fs.existsSync(path.resolve('.env'))) {
  console.error(
    '❌ Khong tim thay file .env tại đường dẫn:',
    path.resolve('.env'),
  );
  process.exit(1);
}

// 3. Định nghĩa Schema
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

// 4. Parse và Validate
const configServer = configSchema.safeParse(process.env);

if (!configServer.success) {
  // Nếu thất bại: In lỗi chi tiết từ Zod
  console.error(
    '❌ Invalid environment variables:',
    configServer.error.flatten().fieldErrors,
  );
  process.exit(1);
}

// 5. Export data đã được validate và có kiểu dữ liệu (Type-safe)
const envConfig = configServer.data;

console.log('✅ Environment variables loaded successfully.');

export default envConfig;
