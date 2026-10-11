-- Additive creator chat. Does not alter contests, submissions, ratings, or leaderboards.
-- Messages belong to one accepted friendship and disappear when that row is deleted.
-- Playback stays a presigned GET. This migration does not change bucket policy.

CREATE TYPE "ChatAttachmentKind" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "friendshipId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT,
    "attachmentKey" TEXT,
    "attachmentKind" "ChatAttachmentKind",
    "attachmentMime" TEXT,
    "attachmentBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_reads" (
    "friendshipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("friendshipId", "userId")
);

CREATE UNIQUE INDEX "chat_messages_attachmentKey_key" ON "chat_messages"("attachmentKey");

CREATE INDEX "chat_messages_friendshipId_createdAt_idx" ON "chat_messages"("friendshipId", "createdAt");

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_friendshipId_fkey" FOREIGN KEY ("friendshipId") REFERENCES "friendships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_friendshipId_fkey" FOREIGN KEY ("friendshipId") REFERENCES "friendships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Body length 2000 is an engineering default. A product limit is NOT SPECIFIED.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_check" CHECK (
    "body" IS NULL OR char_length("body") <= 2000
);

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_content_check" CHECK (
    ("body" IS NOT NULL AND char_length(btrim("body")) > 0)
    OR "attachmentKey" IS NOT NULL
);

-- 104857600 is VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES. A separate chat cap is NOT SPECIFIED.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_attachment_check" CHECK (
    (
        "attachmentKey" IS NULL
        AND "attachmentKind" IS NULL
        AND "attachmentMime" IS NULL
        AND "attachmentBytes" IS NULL
    )
    OR (
        "attachmentKey" IS NOT NULL
        AND "attachmentKind" IS NOT NULL
        AND "attachmentMime" IS NOT NULL
        AND "attachmentBytes" IS NOT NULL
        AND "attachmentBytes" > 0
        AND "attachmentBytes" <= 104857600
        AND "attachmentKey" ~ '^chat/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$'
    )
);

CREATE OR REPLACE FUNCTION "chat_participant_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    actor text;
BEGIN
    actor := CASE
        WHEN TG_TABLE_NAME = 'chat_messages' THEN NEW."senderId"
        ELSE NEW."userId"
    END;
    IF NOT EXISTS (
        SELECT 1
        FROM "friendships" f
        WHERE f."id" = NEW."friendshipId"
          AND f."status" = 'ACCEPTED'
          AND (f."userLowId" = actor OR f."userHighId" = actor)
    ) THEN
        RAISE EXCEPTION 'chat participant is not an accepted friend';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_messages_participant"
BEFORE INSERT OR UPDATE ON "chat_messages"
FOR EACH ROW EXECUTE FUNCTION "chat_participant_guard"();

CREATE TRIGGER "chat_reads_participant"
BEFORE INSERT OR UPDATE ON "chat_reads"
FOR EACH ROW EXECUTE FUNCTION "chat_participant_guard"();
