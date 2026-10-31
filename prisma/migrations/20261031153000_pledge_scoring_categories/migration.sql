-- Pledge scoring dimensions. Nullable JSON so existing contests stay valid.
-- Apply on an isolated database before production. Do not run against production from this change.
ALTER TABLE "contests" ADD COLUMN "scoringCategories" JSONB;
ALTER TABLE "contests" ADD COLUMN "combinedScoreEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ratings" ADD COLUMN "categoryScores" JSONB;
