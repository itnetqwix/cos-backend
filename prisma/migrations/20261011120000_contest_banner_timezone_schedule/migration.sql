-- Contest banner object key, IANA timezone, and voting closure.
-- Existing rows keep their schedule. Timezone defaults to Asia/Kolkata.
-- votingClosesAt and bannerObjectKey stay null until an admin sets them.
-- Does not delete or rewrite contests, submissions, ratings, or users.

ALTER TABLE "contests" ADD COLUMN "bannerObjectKey" TEXT;
ALTER TABLE "contests" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE "contests" ADD COLUMN "votingClosesAt" TIMESTAMP(3);
