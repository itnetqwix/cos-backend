-- Pledge monthly winner count and upload limits. Nullable so existing
-- contests, One Toke, and already published months are not assigned a count.
ALTER TABLE "contests" ADD COLUMN "winnerCount" INTEGER;
ALTER TABLE "contests" ADD COLUMN "maxVideoSizeMb" INTEGER;
ALTER TABLE "contests" ADD COLUMN "maxVideoDurationSeconds" INTEGER;
ALTER TABLE "contests" ADD COLUMN "allowedVideoFormats" JSONB;
ALTER TABLE "contests" ADD COLUMN "rankingNeedsReview" BOOLEAN NOT NULL DEFAULT false;
