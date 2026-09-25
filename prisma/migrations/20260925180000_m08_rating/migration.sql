-- M08-P01 Rating.
-- Incremental only. Does not alter organizations, users, contests, submissions columns, or audit_logs.
-- Indexes are not unique. Duplicate-vote window and fingerprint algorithm are NOT SPECIFIED.
-- No leaderboard table (M09).

CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT,
    "voterFingerprint" TEXT,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ratings_submissionId_idx" ON "ratings"("submissionId");
CREATE INDEX "ratings_voterFingerprint_submissionId_idx" ON "ratings"("voterFingerprint", "submissionId");

ALTER TABLE "ratings"
ADD CONSTRAINT "ratings_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ratings"
ADD CONSTRAINT "ratings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
