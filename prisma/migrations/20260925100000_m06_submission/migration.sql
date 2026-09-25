-- M06-P01-T04 Submission model and SubmissionStatus enum.
-- Incremental only. Does not recreate organizations, users, categories, or contests.
-- Does not add M07 moderation columns or M08 rating relations.

CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED');

CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "tags" TEXT[],
    "communityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submissions_objectKey_key" ON "submissions"("objectKey");
CREATE INDEX "submissions_contestId_status_idx" ON "submissions"("contestId", "status");
CREATE INDEX "submissions_creatorId_idx" ON "submissions"("creatorId");

ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_contestId_fkey"
FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
