-- 420 Dating module. Additive. Does not alter contests, submissions,
-- ratings, friendships, or the users credential columns.
-- Do not apply this migration to production from a development session.

CREATE TYPE "DatingGender" AS ENUM ('MAN', 'WOMAN', 'NON_BINARY', 'TRANSGENDER', 'OTHER');
CREATE TYPE "DatingIntention" AS ENUM ('LONG_TERM', 'CASUAL', 'PUFF_AND_PASS_FRIEND', 'NEW_FRIENDS', 'NOT_SURE');
CREATE TYPE "CannabisExperienceLevel" AS ENUM ('CANNA_CURIOUS', 'CASUAL_PUFFER', 'CONNOISSEUR', 'BUDTENDER_PRO');
CREATE TYPE "DatingProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'BANNED');
CREATE TYPE "DatingVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING_SELFIE', 'VERIFIED', 'REJECTED');
CREATE TYPE "PhotoModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'FLAGGED', 'REJECTED');
CREATE TYPE "LikeTargetType" AS ENUM ('PROFILE', 'PHOTO', 'PROMPT');
CREATE TYPE "DatingReportCategory" AS ENUM ('UNDERAGE', 'HARASSMENT', 'SOLICITATION_OR_DRUG_DEALING', 'INAPPROPRIATE_CONTENT', 'FAKE_PROFILE', 'SPAM', 'OTHER');
CREATE TYPE "DatingReportStatus" AS ENUM ('PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "DatingNotificationType" AS ENUM ('NEW_MATCH', 'NEW_LIKE', 'NEW_MESSAGE', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED', 'SYSTEM_NOTICE');

CREATE TABLE "dating_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "gender" "DatingGender" NOT NULL,
    "interestedIn" TEXT[] NOT NULL,
    "bio" TEXT,
    "datingIntention" "DatingIntention" NOT NULL DEFAULT 'NOT_SURE',
    "consumptionHabits" TEXT[] NOT NULL,
    "favoriteStrains" TEXT[] NOT NULL,
    "cannabisExperienceLevel" "CannabisExperienceLevel" NOT NULL DEFAULT 'CASUAL_PUFFER',
    "favoriteMethods" TEXT[] NOT NULL,
    "lifestyleInterests" TEXT[] NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'USA',
    "latitudeFuzzy" DOUBLE PRECISION,
    "longitudeFuzzy" DOUBLE PRECISION,
    "voiceIntroObjectKey" TEXT,
    "voiceIntroDurationSeconds" INTEGER,
    "vibeAnswers" JSONB,
    "profilePrompts" JSONB,
    "verificationStatus" "DatingVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationPhotoKey" TEXT,
    "status" "DatingProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "isIncognito" BOOLEAN NOT NULL DEFAULT false,
    "isDistanceHidden" BOOLEAN NOT NULL DEFAULT false,
    "isAgeHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_profiles_userId_key" ON "dating_profiles"("userId");
CREATE UNIQUE INDEX "dating_profiles_voiceIntroObjectKey_key" ON "dating_profiles"("voiceIntroObjectKey");
CREATE INDEX "dating_profiles_status_gender_idx" ON "dating_profiles"("status", "gender");
CREATE INDEX "dating_profiles_status_city_state_idx" ON "dating_profiles"("status", "city", "state");
CREATE INDEX "dating_profiles_status_createdAt_idx" ON "dating_profiles"("status", "createdAt");
CREATE INDEX "dating_profiles_userId_idx" ON "dating_profiles"("userId");

CREATE TABLE "dating_photos" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "caption" VARCHAR(140),
    "moderationStatus" "PhotoModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_photos_objectKey_key" ON "dating_photos"("objectKey");
CREATE INDEX "dating_photos_profileId_sortOrder_idx" ON "dating_photos"("profileId", "sortOrder");
CREATE INDEX "dating_photos_profileId_isPrimary_idx" ON "dating_photos"("profileId", "isPrimary");
CREATE UNIQUE INDEX "dating_photos_one_primary_per_profile" ON "dating_photos"("profileId") WHERE "isPrimary" = true;

CREATE TABLE "dating_preferences" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL DEFAULT 18,
    "maxAge" INTEGER NOT NULL DEFAULT 99,
    "ageDealbreaker" BOOLEAN NOT NULL DEFAULT false,
    "maxDistanceMiles" INTEGER NOT NULL DEFAULT 50,
    "distanceDealbreaker" BOOLEAN NOT NULL DEFAULT false,
    "targetGenders" TEXT[] NOT NULL,
    "genderDealbreaker" BOOLEAN NOT NULL DEFAULT false,
    "cannabisHabitsFilter" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cannabisHabitsDealbreaker" BOOLEAN NOT NULL DEFAULT false,
    "intentionsFilter" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "intentionsDealbreaker" BOOLEAN NOT NULL DEFAULT false,
    "verifiedOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_preferences_profileId_key" ON "dating_preferences"("profileId");

CREATE TABLE "dating_likes" (
    "id" TEXT NOT NULL,
    "senderProfileId" TEXT NOT NULL,
    "receiverProfileId" TEXT NOT NULL,
    "isPass" BOOLEAN NOT NULL DEFAULT false,
    "comment" VARCHAR(500),
    "targetType" "LikeTargetType" NOT NULL DEFAULT 'PROFILE',
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dating_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_likes_senderProfileId_receiverProfileId_key" ON "dating_likes"("senderProfileId", "receiverProfileId");
CREATE INDEX "dating_likes_receiverProfileId_isPass_createdAt_idx" ON "dating_likes"("receiverProfileId", "isPass", "createdAt");
CREATE INDEX "dating_likes_senderProfileId_isPass_createdAt_idx" ON "dating_likes"("senderProfileId", "isPass", "createdAt");

CREATE TABLE "dating_matches" (
    "id" TEXT NOT NULL,
    "profileLowId" TEXT NOT NULL,
    "profileHighId" TEXT NOT NULL,
    "originatingLikeId" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unmatchedAt" TIMESTAMP(3),
    "unmatchedById" TEXT,
    "unmatchReason" TEXT,

    CONSTRAINT "dating_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_matches_profileLowId_profileHighId_key" ON "dating_matches"("profileLowId", "profileHighId");
CREATE INDEX "dating_matches_profileLowId_isActive_idx" ON "dating_matches"("profileLowId", "isActive");
CREATE INDEX "dating_matches_profileHighId_isActive_idx" ON "dating_matches"("profileHighId", "isActive");

CREATE TABLE "dating_conversations" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageSnippet" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_conversations_matchId_key" ON "dating_conversations"("matchId");
CREATE INDEX "dating_conversations_lastMessageAt_idx" ON "dating_conversations"("lastMessageAt");

CREATE TABLE "dating_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderProfileId" TEXT NOT NULL,
    "body" TEXT,
    "attachmentKey" TEXT,
    "attachmentKind" "ChatAttachmentKind",
    "attachmentMime" TEXT,
    "attachmentBytes" INTEGER,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dating_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_messages_attachmentKey_key" ON "dating_messages"("attachmentKey");
CREATE INDEX "dating_messages_conversationId_createdAt_idx" ON "dating_messages"("conversationId", "createdAt");

CREATE TABLE "dating_blocks" (
    "id" TEXT NOT NULL,
    "blockerProfileId" TEXT NOT NULL,
    "blockedProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dating_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dating_blocks_blockerProfileId_blockedProfileId_key" ON "dating_blocks"("blockerProfileId", "blockedProfileId");
CREATE INDEX "dating_blocks_blockerProfileId_idx" ON "dating_blocks"("blockerProfileId");
CREATE INDEX "dating_blocks_blockedProfileId_idx" ON "dating_blocks"("blockedProfileId");

CREATE TABLE "dating_reports" (
    "id" TEXT NOT NULL,
    "reporterProfileId" TEXT NOT NULL,
    "reportedProfileId" TEXT NOT NULL,
    "reasonCategory" "DatingReportCategory" NOT NULL,
    "details" TEXT,
    "evidencePhotoKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "DatingReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dating_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dating_reports_status_createdAt_idx" ON "dating_reports"("status", "createdAt");
CREATE INDEX "dating_reports_reportedProfileId_idx" ON "dating_reports"("reportedProfileId");

CREATE TABLE "dating_notifications" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "DatingNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "relatedEntityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dating_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dating_notifications_profileId_readAt_idx" ON "dating_notifications"("profileId", "readAt");
CREATE INDEX "dating_notifications_profileId_createdAt_idx" ON "dating_notifications"("profileId", "createdAt");

ALTER TABLE "dating_profiles" ADD CONSTRAINT "dating_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_photos" ADD CONSTRAINT "dating_photos_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_preferences" ADD CONSTRAINT "dating_preferences_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_likes" ADD CONSTRAINT "dating_likes_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_likes" ADD CONSTRAINT "dating_likes_receiverProfileId_fkey" FOREIGN KEY ("receiverProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_matches" ADD CONSTRAINT "dating_matches_profileLowId_fkey" FOREIGN KEY ("profileLowId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_matches" ADD CONSTRAINT "dating_matches_profileHighId_fkey" FOREIGN KEY ("profileHighId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_matches" ADD CONSTRAINT "dating_matches_originatingLikeId_fkey" FOREIGN KEY ("originatingLikeId") REFERENCES "dating_likes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dating_matches" ADD CONSTRAINT "dating_matches_unmatchedById_fkey" FOREIGN KEY ("unmatchedById") REFERENCES "dating_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dating_conversations" ADD CONSTRAINT "dating_conversations_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "dating_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_messages" ADD CONSTRAINT "dating_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "dating_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_messages" ADD CONSTRAINT "dating_messages_senderProfileId_fkey" FOREIGN KEY ("senderProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_blocks" ADD CONSTRAINT "dating_blocks_blockerProfileId_fkey" FOREIGN KEY ("blockerProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_blocks" ADD CONSTRAINT "dating_blocks_blockedProfileId_fkey" FOREIGN KEY ("blockedProfileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dating_reports" ADD CONSTRAINT "dating_reports_reporterProfileId_fkey" FOREIGN KEY ("reporterProfileId") REFERENCES "dating_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dating_reports" ADD CONSTRAINT "dating_reports_reportedProfileId_fkey" FOREIGN KEY ("reportedProfileId") REFERENCES "dating_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dating_reports" ADD CONSTRAINT "dating_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dating_notifications" ADD CONSTRAINT "dating_notifications_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "dating_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dating_matches" ADD CONSTRAINT "chk_dating_match_canonical_order" CHECK ("profileLowId" < "profileHighId");
ALTER TABLE "dating_matches" ADD CONSTRAINT "chk_dating_match_no_self" CHECK ("profileLowId" <> "profileHighId");
ALTER TABLE "dating_likes" ADD CONSTRAINT "chk_dating_like_no_self" CHECK ("senderProfileId" <> "receiverProfileId");
ALTER TABLE "dating_blocks" ADD CONSTRAINT "chk_dating_block_no_self" CHECK ("blockerProfileId" <> "blockedProfileId");
ALTER TABLE "dating_reports" ADD CONSTRAINT "chk_dating_report_no_self" CHECK ("reporterProfileId" <> "reportedProfileId");
ALTER TABLE "dating_preferences" ADD CONSTRAINT "chk_dating_min_age_18" CHECK ("minAge" >= 18 AND "maxAge" >= "minAge" AND "maxAge" <= 99);
ALTER TABLE "dating_preferences" ADD CONSTRAINT "chk_dating_distance_bounds" CHECK ("maxDistanceMiles" >= 5 AND "maxDistanceMiles" <= 100);
ALTER TABLE "dating_profiles" ADD CONSTRAINT "chk_dating_profile_adult" CHECK ("birthDate" <= (CURRENT_DATE - INTERVAL '18 years'));
ALTER TABLE "dating_messages" ADD CONSTRAINT "chk_dating_message_content" CHECK (
    ("body" IS NOT NULL AND char_length(btrim("body")) > 0) OR "attachmentKey" IS NOT NULL
);
ALTER TABLE "dating_messages" ADD CONSTRAINT "chk_dating_message_body_length" CHECK (
    "body" IS NULL OR char_length("body") <= 2000
);

CREATE OR REPLACE FUNCTION enforce_dating_photo_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM "dating_photos" WHERE "profileId" = NEW."profileId") >= 6 THEN
    RAISE EXCEPTION 'A dating profile cannot have more than 6 photos.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_dating_photo_limit
BEFORE INSERT ON "dating_photos"
FOR EACH ROW
EXECUTE FUNCTION enforce_dating_photo_limit();

CREATE OR REPLACE FUNCTION dating_message_participant_guard()
RETURNS TRIGGER AS $$
DECLARE
  low text;
  high text;
  match_active boolean;
BEGIN
  SELECT m."profileLowId", m."profileHighId", m."isActive"
    INTO low, high, match_active
  FROM "dating_conversations" c
  JOIN "dating_matches" m ON m."id" = c."matchId"
  WHERE c."id" = NEW."conversationId";

  IF low IS NULL THEN
    RAISE EXCEPTION 'Dating conversation was not found';
  END IF;
  IF NEW."senderProfileId" <> low AND NEW."senderProfileId" <> high THEN
    RAISE EXCEPTION 'Sender is not a participant in this dating conversation';
  END IF;
  IF match_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Dating match is not active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dating_message_participant
BEFORE INSERT ON "dating_messages"
FOR EACH ROW
EXECUTE FUNCTION dating_message_participant_guard();
