-- M05-P01-T05 Contest and Category tables.
-- Incremental only. Does not recreate organizations or users.

CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'JUDGING', 'COMPLETED', 'ARCHIVED');

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "prizeSummary" TEXT,
    "rules" JSONB,
    "autoAdvanceDelayMs" INTEGER NOT NULL DEFAULT 1800,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_organizationId_slug_key" ON "categories"("organizationId", "slug");
CREATE INDEX "contests_organizationId_status_idx" ON "contests"("organizationId", "status");

ALTER TABLE "categories"
ADD CONSTRAINT "categories_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contests"
ADD CONSTRAINT "contests_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contests"
ADD CONSTRAINT "contests_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
