-- Additive creator friendships. Does not alter contests, submissions,
-- ratings, comments, or leaderboard data.
-- One row per unordered pair. userLowId is the smaller user id.
-- requesterId must be one of the two users. Reject, cancel, and remove delete the row.

CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friendships_userLowId_userHighId_key" ON "friendships"("userLowId", "userHighId");

CREATE INDEX "friendships_userLowId_status_idx" ON "friendships"("userLowId", "status");

CREATE INDEX "friendships_userHighId_status_idx" ON "friendships"("userHighId", "status");

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_ordered_pair_check" CHECK ("userLowId" < "userHighId");

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_member_check" CHECK ("requesterId" = "userLowId" OR "requesterId" = "userHighId");
