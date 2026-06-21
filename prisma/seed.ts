/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';

config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the seed script');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const defaultInitialCode = {
  BASIC_JS: {
    'index.js': {
      file: {
        contents:
          'function solution(input) {\n  return input;\n}\n\nconsole.log(solution("hello"));\n',
      },
    },
  },
  NEXTJS: {
    'package.json': {
      file: {
        contents:
          '{"scripts":{"dev":"next dev --hostname 0.0.0.0"},"dependencies":{"next":"latest","react":"latest","react-dom":"latest"}}',
      },
    },
    'app/page.tsx': {
      file: {
        contents:
          'export default function Page() {\n  return <main>Hello from Next.js</main>;\n}\n',
      },
    },
  },
  REACT_VITE: {
    'package.json': {
      file: {
        contents:
          '{"scripts":{"dev":"vite --host 0.0.0.0"},"dependencies":{"@vitejs/plugin-react":"latest","vite":"latest","react":"latest","react-dom":"latest"}}',
      },
    },
    'src/App.jsx': {
      file: {
        contents:
          'export default function App() {\n  return <main>Hello from React + Vite</main>;\n}\n',
      },
    },
  },
  BLANK_CUSTOM: {
    'README.md': {
      file: {
        contents: '# Custom test\n\nAdd starter files for this scenario.\n',
      },
    },
  },
} as const;

async function upsertPublicTemplate(
  templateType: keyof typeof defaultInitialCode,
  name: string,
  description: string,
) {
  const existing = await prisma.template.findFirst({
    where: { templateType, isPublic: true },
  });

  const data = {
    name,
    description,
    templateType,
    initialCode: defaultInitialCode[templateType],
    isPublic: true,
    companyId: null,
    createdBy: null,
  };

  if (existing) {
    return prisma.template.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.template.create({ data });
}

async function main() {
  const adminEmail = 'phanhuudanhkg123@gmail.com';

  await prisma.company.upsert({
    where: { name: 'Default Company' },
    update: {},
    create: { name: 'Default Company' },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      companyId: null,
    },
    create: {
      email: adminEmail,
      name: 'AI-TechFlow Admin',
      role: 'ADMIN',
    },
  });

  await upsertPublicTemplate(
    'BASIC_JS',
    'Basic JavaScript',
    'A minimal JavaScript coding test template.',
  );
  await upsertPublicTemplate(
    'NEXTJS',
    'Next.js',
    'A starter Next.js project for frontend tasks.',
  );
  await upsertPublicTemplate(
    'REACT_VITE',
    'React + Vite',
    'A lightweight React project powered by Vite.',
  );
  await upsertPublicTemplate(
    'BLANK_CUSTOM',
    'Blank Custom',
    'An empty template for fully custom scenarios.',
  );

  console.log(
    'Seed completed: admin, default company, and templates are ready.',
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
