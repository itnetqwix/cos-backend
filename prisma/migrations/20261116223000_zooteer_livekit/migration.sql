-- PZ-M04 LiveKit room mapping and disconnect grace.
-- Additive. Do not apply to production.

ALTER TABLE "zooteer_rooms" ADD COLUMN "livekitRoomName" TEXT;
CREATE UNIQUE INDEX "zooteer_rooms_livekitRoomName_key" ON "zooteer_rooms"("livekitRoomName");

ALTER TABLE "zooteer_participants" ADD COLUMN "disconnectedAt" TIMESTAMP(3);

ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'MEDIA_PROVISIONED';
ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'PARTICIPANT_DISCONNECTED';
ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'PARTICIPANT_RECONNECTED';
ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'PARTICIPANT_GRACE_EXPIRED';

ALTER TYPE "ZooteerAuditAction" ADD VALUE 'MEDIA_TOKEN';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'MEDIA_CLEANUP';
