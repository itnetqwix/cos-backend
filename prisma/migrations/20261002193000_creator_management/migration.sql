-- Creator account status, administrative warnings, and creator activity log.
-- Existing users default to ACTIVE. No rows are deleted.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BLOCKED');

CREATE TYPE "CreatorActivityAction" AS ENUM (
  'REGISTERED',
  'LOGGED_IN',
  'SUBMISSION_UPLOADED',
  'SUBMISSION_APPROVED',
  'SUBMISSION_REJECTED',
  'SUBMISSION_FLAGGED',
  'SUBMISSION_DELETED',
  'BLOCKED',
  'UNBLOCKED',
  'WARNED'
);

ALTER TABLE "users" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "users_role_accountStatus_idx" ON "users"("role", "accountStatus");
CREATE INDEX "users_role_createdAt_idx" ON "users"("role", "createdAt");

CREATE TABLE "creator_warnings" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_warnings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creator_warnings_creatorId_createdAt_idx" ON "creator_warnings"("creatorId", "createdAt");

ALTER TABLE "creator_warnings" ADD CONSTRAINT "creator_warnings_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creator_warnings" ADD CONSTRAINT "creator_warnings_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "creator_activity_logs" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "action" "CreatorActivityAction" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "relatedSubmissionId" TEXT,
    "relatedContestId" TEXT,
    "performedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creator_activity_logs_creatorId_createdAt_idx" ON "creator_activity_logs"("creatorId", "createdAt");
CREATE INDEX "creator_activity_logs_relatedContestId_idx" ON "creator_activity_logs"("relatedContestId");
CREATE INDEX "creator_activity_logs_relatedSubmissionId_idx" ON "creator_activity_logs"("relatedSubmissionId");

ALTER TABLE "creator_activity_logs" ADD CONSTRAINT "creator_activity_logs_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creator_activity_logs" ADD CONSTRAINT "creator_activity_logs_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
