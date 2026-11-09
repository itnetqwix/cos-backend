-- CreateEnum
CREATE TYPE "VideoDomain" AS ENUM ('REGULAR', 'PLEDGE');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "domain" "VideoDomain" NOT NULL DEFAULT 'REGULAR';

-- CreateIndex
CREATE INDEX "submissions_domain_status_idx" ON "submissions"("domain", "status");
CREATE INDEX "submissions_domain_createdAt_idx" ON "submissions"("domain", "createdAt");

-- Classify existing Pledge submissions
UPDATE "submissions"
SET "domain" = 'PLEDGE'
FROM "contests"
WHERE "submissions"."contestId" = "contests"."id"
  AND "contests"."seriesSlug" = 'pledge';

