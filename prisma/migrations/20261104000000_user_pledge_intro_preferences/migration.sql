-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pledgeIntroSeenAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pledgeIntroVersion" TEXT;

