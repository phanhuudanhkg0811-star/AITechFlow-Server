-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('BASIC_JS', 'NEXTJS', 'REACT_VITE', 'BLANK_CUSTOM');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'COMPANY_ROOT', 'HR', 'CANDIDATE');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE
    WHEN "role"::text = 'TECH_LEAD' THEN 'HR'
    ELSE "role"::text
  END::"Role_new"
);
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CANDIDATE';
COMMIT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "tokenUsage" INTEGER NOT NULL DEFAULT 0,
    "aiSuggestionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateType" "TemplateType" NOT NULL,
    "initialCode" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_email_key" ON "EmailAccount"("email");

-- Backfill default tenant before enforcing tenant-owned jobs.
INSERT INTO "Company" ("id", "name", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Company', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;

UPDATE "User"
SET "companyId" = '00000000-0000-4000-8000-000000000001'
WHERE "role" = 'HR' AND "companyId" IS NULL;

-- AlterTable
ALTER TABLE "JobDescription"
ADD COLUMN "companyId" TEXT,
ADD COLUMN "defaultScenarioId" TEXT,
ADD COLUMN "emailAccountId" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "jobReference" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "JobDescription" AS job
SET "companyId" = COALESCE("User"."companyId", '00000000-0000-4000-8000-000000000001')
FROM "User"
WHERE job."creatorId" = "User"."id";

UPDATE "JobDescription"
SET "companyId" = '00000000-0000-4000-8000-000000000001'
WHERE "companyId" IS NULL;

ALTER TABLE "JobDescription" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "JobDescription" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestScenario"
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "templateId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH ranked_scenarios AS (
  SELECT "id", "jobId", ROW_NUMBER() OVER (PARTITION BY "jobId" ORDER BY "createdAt", "id") AS row_number
  FROM "TestScenario"
)
UPDATE "TestScenario" AS scenario
SET "isDefault" = true
FROM ranked_scenarios
WHERE scenario."id" = ranked_scenarios."id"
  AND ranked_scenarios.row_number = 1;

WITH ranked_scenarios AS (
  SELECT "id", "jobId", ROW_NUMBER() OVER (PARTITION BY "jobId" ORDER BY "createdAt", "id") AS row_number
  FROM "TestScenario"
)
UPDATE "JobDescription" AS job
SET "defaultScenarioId" = ranked_scenarios."id"
FROM ranked_scenarios
WHERE job."id" = ranked_scenarios."jobId"
  AND ranked_scenarios.row_number = 1;

ALTER TABLE "TestScenario" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Migrate legacy job inboxes into inactive EmailAccount records.
INSERT INTO "EmailAccount" ("id", "email", "encryptedPassword", "userId", "companyId", "isActive", "createdAt", "updatedAt")
SELECT md5(job."hrEmail"), job."hrEmail", '', job."creatorId", job."companyId", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "JobDescription" AS job
WHERE job."hrEmail" IS NOT NULL
  AND job."creatorId" IS NOT NULL
ON CONFLICT ("email") DO NOTHING;

UPDATE "JobDescription" AS job
SET "emailAccountId" = email_account."id"
FROM "EmailAccount" AS email_account
WHERE job."hrEmail" = email_account."email";

-- DropIndex
DROP INDEX IF EXISTS "JobDescription_hrEmail_key";

-- AlterTable
ALTER TABLE "JobDescription" DROP COLUMN "hrEmail";

-- CreateIndex
CREATE UNIQUE INDEX "JobDescription_defaultScenarioId_key" ON "JobDescription"("defaultScenarioId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_defaultScenarioId_fkey" FOREIGN KEY ("defaultScenarioId") REFERENCES "TestScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestScenario" ADD CONSTRAINT "TestScenario_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
