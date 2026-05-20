import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';

// 1. Load file .env lên để lấy DATABASE_URL
config();

if (!process.env.DATABASE_URL) {
  throw new Error('❌ Không tìm thấy DATABASE_URL trong file .env');
}

// 2. Khởi tạo Adapter
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// 3. Nhét adapter vào thẳng PrismaClient
const prisma = new PrismaClient({ adapter });

async function main() {
  const HR_EMAIL = 'phanhuudanhkg123@gmail.com';

  console.log('🧹 Đang dọn dẹp dữ liệu cũ (tuỳ chọn)...');
  // Nếu bạn muốn script này tự truncate các bảng mỗi khi chạy tay, mở comment đoạn dưới:
  // await prisma.testSession.deleteMany();
  // await prisma.application.deleteMany();
  // await prisma.testScenario.deleteMany();
  // await prisma.jobDescription.deleteMany();
  // await prisma.user.deleteMany();

  console.log(`⏳ Đang tạo tài khoản HR: ${HR_EMAIL}...`);

  // Dùng upsert để nếu chạy seed 2 lần cũng không bị lỗi trùng email
  const hrUser = await prisma.user.upsert({
    where: { email: HR_EMAIL },
    update: {}, // Nếu đã tồn tại thì không làm gì cả
    create: {
      email: HR_EMAIL,
      name: 'Phan Hữu Danh (HR)',
      role: 'HR',
    },
  });

  console.log(
    `✅ Thành công! Đã tạo/tìm thấy tài khoản HR: ${hrUser.email} (ID: ${hrUser.id})`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi chạy seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Đóng pool kết nối của pg
    await pool.end();
  });
