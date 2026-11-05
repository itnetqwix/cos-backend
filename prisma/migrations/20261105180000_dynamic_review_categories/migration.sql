-- AlterTable
ALTER TABLE "review_categories" ADD COLUMN "description" TEXT,
ADD COLUMN "mergedIntoId" TEXT,
ALTER COLUMN "sortOrder" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "review_categories_isActive_idx" ON "review_categories"("isActive");
CREATE INDEX "review_categories_sortOrder_idx" ON "review_categories"("sortOrder");

-- AddForeignKey for category merges
ALTER TABLE "review_categories" ADD CONSTRAINT "review_categories_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "review_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "CategoryProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "review_category_proposals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CategoryProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposerId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_category_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_category_proposals_status_idx" ON "review_category_proposals"("status");
CREATE INDEX "review_category_proposals_proposerId_idx" ON "review_category_proposals"("proposerId");

-- AddForeignKey
ALTER TABLE "review_category_proposals" ADD CONSTRAINT "review_category_proposals_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_category_proposals" ADD CONSTRAINT "review_category_proposals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_category_proposals" ADD CONSTRAINT "review_category_proposals_approvedCategoryId_fkey" FOREIGN KEY ("approvedCategoryId") REFERENCES "review_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill descriptions for existing six review categories
UPDATE "review_categories" SET "description" = 'Aroma profile, terpene intensity, and scent characteristics' WHERE "slug" = 'smell' AND "description" IS NULL;
UPDATE "review_categories" SET "description" = 'Flavor profile, smoothness, and terpene expression on inhale and exhale' WHERE "slug" = 'taste' AND "description" IS NULL;
UPDATE "review_categories" SET "description" = 'Psychoactive potency, onset speed, and overall effects' WHERE "slug" = 'how-high-it-gets-you' AND "description" IS NULL;
UPDATE "review_categories" SET "description" = 'Visual cure, trichome density, structure, and moisture balance' WHERE "slug" = 'texture' AND "description" IS NULL;
UPDATE "review_categories" SET "description" = 'Smoothness of smoke or vapor, throat hit, and clean burn quality' WHERE "slug" = 'harshness' AND "description" IS NULL;
UPDATE "review_categories" SET "description" = 'Cure age, stickiness, and preservation of trichomes and terpenes' WHERE "slug" = 'freshness' AND "description" IS NULL;

