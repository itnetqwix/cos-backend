-- PZ-M05 abuse reports. Chat messages are not stored.
-- Additive. Do not apply to production.

ALTER TYPE "ZooteerAuditAction" ADD VALUE 'REPORT_CREATE';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'REPORT_REVIEW';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'REPORT_RESOLVE';

CREATE TYPE "ZooteerReportCategory" AS ENUM ('HARASSMENT', 'HATE', 'SEXUAL', 'VIOLENCE', 'SPAM', 'OTHER');
CREATE TYPE "ZooteerReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED');

CREATE TABLE "zooteer_abuse_reports" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "category" "ZooteerReportCategory" NOT NULL,
    "description" TEXT,
    "status" "ZooteerReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "zooteer_abuse_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zooteer_abuse_reports_roomId_createdAt_idx" ON "zooteer_abuse_reports"("roomId", "createdAt");
CREATE INDEX "zooteer_abuse_reports_status_createdAt_idx" ON "zooteer_abuse_reports"("status", "createdAt");

ALTER TABLE "zooteer_abuse_reports" ADD CONSTRAINT "zooteer_abuse_reports_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "zooteer_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_abuse_reports" ADD CONSTRAINT "zooteer_abuse_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_abuse_reports" ADD CONSTRAINT "zooteer_abuse_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_abuse_reports" ADD CONSTRAINT "zooteer_abuse_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
