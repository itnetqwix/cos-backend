-- M07-P01-T02 AuditAction, AuditLog, and submission moderation columns.
-- Incremental only. Does not recreate organizations, users, contests, or submissions.
-- Does not add Rating (M08). Retention / purge is NOT SPECIFIED (no delete policy).

CREATE TYPE "AuditAction" AS ENUM ('APPROVE', 'REJECT', 'FLAG', 'ISSUE_WARNING', 'SUSPEND_CREATOR');

ALTER TABLE "submissions" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "submissions" ADD COLUMN "moderatedById" TEXT;
ALTER TABLE "submissions" ADD COLUMN "moderatedAt" TIMESTAMP(3);

ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_moderatedById_fkey"
FOREIGN KEY ("moderatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");
CREATE INDEX "audit_logs_submissionId_idx" ON "audit_logs"("submissionId");

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
