-- CreateEnum
CREATE TYPE "TesterApplicationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TesterStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'SUSPENDED', 'REVOKED');

-- AlterTable: Add testerStatus with default NOT_VERIFIED
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "testerStatus" "TesterStatus" NOT NULL DEFAULT 'NOT_VERIFIED';

-- Migrate existing testerEnabled data to testerStatus
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'testerEnabled'
  ) THEN
    UPDATE "users" SET "testerStatus" = 'VERIFIED' WHERE "testerEnabled" = true;
    DROP INDEX IF EXISTS "users_testerEnabled_idx";
    ALTER TABLE "users" DROP COLUMN "testerEnabled";
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_testerStatus_idx" ON "users"("testerStatus");

-- CreateTable
CREATE TABLE IF NOT EXISTS "tester_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TesterApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "avatarUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'USA',
    "bio" TEXT,
    "experienceYears" INTEGER,
    "preferredProductTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credentials" TEXT,
    "sampleReviewUrl" TEXT,
    "portfolioUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicantNotes" TEXT,
    "informationRequestedNotes" TEXT,
    "informationResponseNotes" TEXT,
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tester_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tester_applications_userId_status_idx" ON "tester_applications"("userId", "status");
CREATE INDEX IF NOT EXISTS "tester_applications_status_createdAt_idx" ON "tester_applications"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "tester_applications" ADD CONSTRAINT "tester_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tester_applications" ADD CONSTRAINT "tester_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "tester_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "applicationId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tester_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tester_audit_logs_targetUserId_idx" ON "tester_audit_logs"("targetUserId");
CREATE INDEX IF NOT EXISTS "tester_audit_logs_applicationId_idx" ON "tester_audit_logs"("applicationId");
CREATE INDEX IF NOT EXISTS "tester_audit_logs_actorId_idx" ON "tester_audit_logs"("actorId");
CREATE INDEX IF NOT EXISTS "tester_audit_logs_createdAt_idx" ON "tester_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "tester_audit_logs" ADD CONSTRAINT "tester_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tester_audit_logs" ADD CONSTRAINT "tester_audit_logs_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tester_audit_logs" ADD CONSTRAINT "tester_audit_logs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "tester_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

