-- Additive soft-delete columns. Existing rows stay active (both columns null).
-- Does not delete submission rows, ratings, or stored media.
ALTER TABLE "submissions" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "submissions" ADD CONSTRAINT "submissions_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
