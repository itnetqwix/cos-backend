-- Canonical 420 Dating protections Prisma cannot model.
-- Created by migration 20261120120000_add_420_dating_module.
-- Reapply on a LOCAL database only if a generated migration removed them.
-- This file does not drop the objects. Safe to run more than once.
-- Do not point this file at the configured remote DATABASE_URL.

CREATE OR REPLACE FUNCTION enforce_dating_photo_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM "dating_photos" WHERE "profileId" = NEW."profileId") >= 6 THEN
    RAISE EXCEPTION 'A dating profile cannot have more than 6 photos.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

DO $$
BEGIN
  ALTER TABLE "dating_matches" ADD CONSTRAINT "chk_dating_match_canonical_order" CHECK ("profileLowId" < "profileHighId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_matches" ADD CONSTRAINT "chk_dating_match_no_self" CHECK ("profileLowId" <> "profileHighId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_likes" ADD CONSTRAINT "chk_dating_like_no_self" CHECK ("senderProfileId" <> "receiverProfileId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_blocks" ADD CONSTRAINT "chk_dating_block_no_self" CHECK ("blockerProfileId" <> "blockedProfileId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_reports" ADD CONSTRAINT "chk_dating_report_no_self" CHECK ("reporterProfileId" <> "reportedProfileId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_preferences" ADD CONSTRAINT "chk_dating_min_age_18" CHECK ("minAge" >= 18 AND "maxAge" >= "minAge" AND "maxAge" <= 99);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_preferences" ADD CONSTRAINT "chk_dating_distance_bounds" CHECK ("maxDistanceMiles" >= 5 AND "maxDistanceMiles" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_profiles" ADD CONSTRAINT "chk_dating_profile_adult" CHECK (
    (
      "birthDate" IS NOT NULL
      AND "birthDate" <= (CURRENT_DATE - INTERVAL '18 years')
      AND ("statedAge" IS NULL OR ("statedAge" >= 18 AND "statedAge" <= 120))
    )
    OR (
      "birthDate" IS NULL
      AND "statedAge" >= 18
      AND "statedAge" <= 120
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_messages" ADD CONSTRAINT "chk_dating_message_content" CHECK (
    ("body" IS NOT NULL AND char_length(btrim("body")) > 0) OR "attachmentKey" IS NOT NULL
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "dating_messages" ADD CONSTRAINT "chk_dating_message_body_length" CHECK (
    "body" IS NULL OR char_length("body") <= 2000
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "dating_photos_one_primary_per_profile"
  ON "dating_photos"("profileId") WHERE "isPrimary" = true;

DO $$
BEGIN
  CREATE TRIGGER trg_check_dating_photo_limit
  BEFORE INSERT ON "dating_photos"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_dating_photo_limit();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_dating_message_participant
  BEFORE INSERT ON "dating_messages"
  FOR EACH ROW
  EXECUTE FUNCTION dating_message_participant_guard();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
