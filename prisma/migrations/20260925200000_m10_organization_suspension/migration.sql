-- M10-P01-T02 Organization suspension (approved decision, progress Amendment 2026-09-25).
-- Incremental only. Existing organizations become ACTIVE through the column default.
-- Does not alter users, contests, submissions, audit_logs, or ratings.

CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "organizations"
ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspensionReason" TEXT;
