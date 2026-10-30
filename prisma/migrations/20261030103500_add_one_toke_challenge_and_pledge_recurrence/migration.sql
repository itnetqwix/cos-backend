-- M01-P01-T03. Additive only. Not applied by this change.
-- No DROP, DELETE, TRUNCATE, or rewrite of existing rows.
-- Existing contests keep seriesSlug and cycleMonth null. There is no "pledge" default.
-- Existing ratings keep their rows. guestVoterId is null until a token is issued.
-- The (submissionId, voterIpHash) unique index is left in place.

CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'DISQUALIFIED');

ALTER TABLE "users" ADD COLUMN "testerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "reviewApprovalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "testerBio" TEXT;

CREATE INDEX "users_testerEnabled_idx" ON "users"("testerEnabled");
CREATE INDEX "users_reviewApprovalEnabled_idx" ON "users"("reviewApprovalEnabled");

ALTER TABLE "contests" ADD COLUMN "seriesSlug" TEXT;
ALTER TABLE "contests" ADD COLUMN "cycleMonth" TEXT;
ALTER TABLE "contests" ADD COLUMN "isRecurringMonthly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contests" ADD COLUMN "minOverallVoters" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "contests" ADD COLUMN "minCategoryVoters" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "contests" ADD COLUMN "configFrozenAt" TIMESTAMP(3);
ALTER TABLE "contests" ADD COLUMN "isWinnersFinalized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contests" ADD COLUMN "winnersFinalizedAt" TIMESTAMP(3);
ALTER TABLE "contests" ADD COLUMN "winnersData" JSONB;

CREATE UNIQUE INDEX "contests_seriesSlug_cycleMonth_key" ON "contests"("seriesSlug", "cycleMonth");
CREATE INDEX "contests_seriesSlug_status_idx" ON "contests"("seriesSlug", "status");

ALTER TABLE "ratings" ADD COLUMN "guestVoterId" TEXT;

CREATE UNIQUE INDEX "ratings_submissionId_userId_key" ON "ratings"("submissionId", "userId");
CREATE UNIQUE INDEX "ratings_submissionId_guestVoterId_key" ON "ratings"("submissionId", "guestVoterId");
CREATE INDEX "ratings_voterIpHash_submissionId_idx" ON "ratings"("voterIpHash", "submissionId");

CREATE TABLE "product_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_types_slug_key" ON "product_types"("slug");

CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_brandName_name_productTypeId_key" ON "products"("brandName", "name", "productTypeId");
CREATE INDEX "products_productTypeId_idx" ON "products"("productTypeId");

CREATE TABLE "review_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_categories_slug_key" ON "review_categories"("slug");

CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "dispensaryName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'USA',
    "videoUrl" TEXT NOT NULL,
    "videoObjectKey" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightsSnapshot" JSONB NOT NULL,
    "reviewNotes" TEXT,
    "changeRequestNotes" TEXT,
    "rejectionReason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedRevisionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_reviews_videoObjectKey_key" ON "product_reviews"("videoObjectKey");
CREATE INDEX "product_reviews_productId_status_idx" ON "product_reviews"("productId", "status");
CREATE INDEX "product_reviews_testerId_status_idx" ON "product_reviews"("testerId", "status");
CREATE INDEX "product_reviews_status_publishedAt_idx" ON "product_reviews"("status", "publishedAt");
CREATE INDEX "product_reviews_status_overallScore_idx" ON "product_reviews"("status", "overallScore");

CREATE TABLE "review_category_scores" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "weightApplied" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "review_category_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_category_scores_reviewId_categoryId_key" ON "review_category_scores"("reviewId", "categoryId");
CREATE INDEX "review_category_scores_reviewId_idx" ON "review_category_scores"("reviewId");
CREATE INDEX "review_category_scores_categoryId_idx" ON "review_category_scores"("categoryId");

CREATE TABLE "review_revisions" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "scoresSnapshot" JSONB NOT NULL,
    "weightsSnapshot" JSONB NOT NULL,
    "productSnapshot" JSONB NOT NULL,
    "videoObjectKey" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "reviewNotes" TEXT,
    "changeRequestNotes" TEXT,
    "dispensaryName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'USA',
    "changedById" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_revisions_reviewId_version_key" ON "review_revisions"("reviewId", "version");
CREATE INDEX "review_revisions_reviewId_idx" ON "review_revisions"("reviewId");

ALTER TABLE "products" ADD CONSTRAINT "products_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_category_scores" ADD CONSTRAINT "review_category_scores_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_category_scores" ADD CONSTRAINT "review_category_scores_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "review_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
