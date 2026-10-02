-- Private profile-image reference. The bucket stays private.
-- Playback uses a presigned URL and is not stored in this column.

ALTER TABLE "users" ADD COLUMN "avatarObjectKey" TEXT;
