-- Recurring template audit values. Not inserted in this migration.
-- PostgreSQL 12+ accepts ADD VALUE inside the migration transaction
-- when the new values are not used in the same transaction.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECURRENCE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECURRENCE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECURRENCE_PAUSE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECURRENCE_RESUME';

-- @@unique([seriesSlug, cycleMonth]) allows many NULL cycleMonths.
-- One template per series. Generated months are not in this index.
-- This index is not represented in schema.prisma. Do not drop it in a later diff.
CREATE UNIQUE INDEX IF NOT EXISTS "contests_series_template_key"
ON "contests" ("seriesSlug")
WHERE "cycleMonth" IS NULL AND "seriesSlug" IS NOT NULL;
