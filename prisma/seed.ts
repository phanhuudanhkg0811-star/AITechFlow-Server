import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';

// 1. Phải load file .env lên để lấy DATABASE_URL
config();

if (!process.env.DATABASE_URL) {
  throw new Error('❌ Không tìm thấy DATABASE_URL trong file .env');
}

// 2. Khởi tạo Adapter y chang cách NestJS của ông đang vận hành
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// 3. Nhét adapter vào thẳng PrismaClient (TypeScript vừa vui, mà Runtime cũng chạy mượt)
const prisma = new PrismaClient({ adapter });

async function main() {
  // ĐIỀN EMAIL GITHUB CỦA ÔNG VÀO ĐÂY
  const MY_EMAIL = 'phanhuudanhkg0811@gmail.com';

  console.log(`🔍 Đang tìm tài khoản thật của ứng viên: ${MY_EMAIL}...`);
  const me = await prisma.user.findUnique({
    where: { email: MY_EMAIL },
  });

  if (!me) {
    console.error(
      `❌ KHÔNG TÌM THẤY! Ông phải lên web đăng nhập bằng Github 1 lần để nó lưu tài khoản vào DB đã nha!`,
    );
    process.exit(1);
  }

  console.log(
    `✅ Đã tìm thấy tài khoản: ${me.name || me.githubUsername} (ID: ${me.id})`,
  );

  console.log(
    '🧹 Dọn dẹp rác (Job, Scenario, Session cũ) nhưng GIỮ LẠI USER...',
  );
  // Chỉ xóa data liên quan đến thi cử, không đụng chạm bảng User
  await prisma.testSession.deleteMany();
  await prisma.application.deleteMany();
  await prisma.testScenario.deleteMany();
  await prisma.jobDescription.deleteMany();

  console.log('🏗️ Bắt đầu tạo Mock Data...');

  // 1. Tìm hoặc tạo HR (để có người đại diện tạo Job)
  let hrUser = await prisma.user.findUnique({
    where: { email: 'hr@aitechflow.com' },
  });
  if (!hrUser) {
    hrUser = await prisma.user.create({
      data: {
        email: 'hr@aitechflow.com',
        name: 'HR Manager',
        role: 'HR',
      },
    });
  }

  // 2. Tạo Job Description
  const job = await prisma.jobDescription.create({
    data: {
      title: 'Backend Developer (NestJS/Node.js)',
      content:
        'Tìm kiếm ứng viên có khả năng tư duy logic tốt và viết Clean Code.',
      hrEmail: 'hr@aitechflow.com',
      creatorId: hrUser.id,
    },
  });

  // 3. Tạo Test Scenario (Data cho WebContainers)
  const scenario = await prisma.testScenario.create({
    data: {
      jobId: job.id,
      title: 'Thuật toán & Tư duy xử lý mảng',
      difficulty: 'Junior',
      timeLimit: 45,
      context:
        'Viết một hàm kiểm tra xem một chuỗi có chứa các dấu ngoặc hợp lệ hay không (Valid Parentheses). Ví dụ: "()" là true, "(]" là false.',
      initialCode: {
        'index.js': {
          file: {
            contents:
              "/**\n * Yêu cầu: Viết hàm kiểm tra chuỗi ngoặc hợp lệ (Valid Parentheses)\n * Cú pháp hỗ trợ: (), [], {}\n */\nfunction isValid(s) {\n  // TODO: Code của bạn ở đây\n  \n  return false;\n}\n\n// Test cases\nconsole.log('Test 1:', isValid('()[]{}')); // Expected: true\nconsole.log('Test 2:', isValid('([)]')); // Expected: false\n",
          },
        },
        'package.json': {
          file: {
            contents:
              '{\n  "name": "aitechflow-test",\n  "type": "module",\n  "scripts": {\n    "start": "node index.js"\n  }\n}',
          },
        },
      },
    },
  });

  // 4. Tạo Application gắn ĐÚNG ID CỦA ÔNG VÀO (me.id)
  const application = await prisma.application.create({
    data: {
      userId: me.id, // <-- Mấu chốt ở đây!
      jobId: job.id,
      cvText: 'Đã nộp CV thông qua email...',
      status: 'TESTING',
    },
  });

  // 5. Tạo TestSession cho ứng dụng đó
  const session = await prisma.testSession.create({
    data: {
      applicationId: application.id,
      scenarioId: scenario.id,
      startTime: new Date(),
    },
  });

  console.log('✅ Hoàn tất bơm data!');
  console.log('🚀 LINK TEST CHO TÀI KHOẢN CỦA ÔNG LÀ:');
  console.log('\x1b[36m%s\x1b[0m', `http://localhost:3000/tests/${session.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
