-- M05 gap closure. Historical rating rows are kept.
-- Drop the IP-hash unique index so two guest tokens behind one address
-- can each have a row. The non-unique IP index from the Pledge migration
-- stays for anti-abuse lookups.
DROP INDEX IF EXISTS "ratings_submissionId_voterIpHash_key";

-- New enum value. Not used again in this migration, so PostgreSQL can
-- add it inside the migration transaction (PG 12+).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CORRECT_WINNER';
