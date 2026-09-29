-- Single-product Ripskis. Drops organization tenancy.
-- Does not drop the database. Existing BRAND_ADMIN rows become ADMIN.
-- SUPER_ADMIN and VIEWER rows are remapped so the Role enum can shrink;
-- the bootstrap script removes accounts that are not the deployment admin.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_organizationId_fkey";
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_organizationId_fkey";
ALTER TABLE "contests" DROP CONSTRAINT IF EXISTS "contests_organizationId_fkey";

DROP INDEX IF EXISTS "categories_organizationId_slug_key";
DROP INDEX IF EXISTS "contests_organizationId_status_idx";

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY slug ORDER BY "createdAt", id) AS rn
  FROM "categories"
)
UPDATE "categories" AS c
SET slug = c.slug || '-' || substr(c.id::text, 1, 8)
FROM ranked AS r
WHERE c.id = r.id
  AND r.rn > 1;

ALTER TABLE "users" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "categories" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "contests" DROP COLUMN IF EXISTS "organizationId";

CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_key" ON "categories"("slug");
CREATE INDEX IF NOT EXISTS "contests_status_idx" ON "contests"("status");

DROP TABLE IF EXISTS "organizations";
DROP TYPE IF EXISTS "OrganizationStatus";

CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'CREATOR');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'BRAND_ADMIN' THEN 'ADMIN'
    WHEN 'ADMIN' THEN 'ADMIN'
    WHEN 'CREATOR' THEN 'CREATOR'
    ELSE 'CREATOR'
  END
)::"Role_new";

ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CREATOR'::"Role";
