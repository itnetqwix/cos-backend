-- Contest visuals chosen in the admin form, plus one guest vote per video.
-- voter_ip_hash stores an HMAC, never the raw client IP.

ALTER TABLE "contests" ADD COLUMN "tagline" TEXT;
ALTER TABLE "contests" ADD COLUMN "bannerUrl" TEXT;
ALTER TABLE "contests" ADD COLUMN "thumbnailUrl" TEXT;

ALTER TABLE "ratings" ADD COLUMN "voterIpHash" TEXT;

CREATE UNIQUE INDEX "ratings_submissionId_voterIpHash_key"
  ON "ratings"("submissionId", "voterIpHash");
