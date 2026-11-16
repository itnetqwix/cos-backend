-- PZ-M02 Planet Zooteer room foundation.
-- Additive. Does not change contest, pledge, toke, or counter tables.
-- Does not delete rows. Apply only to a non-production database.

CREATE TYPE "ZooteerRoomStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ZooteerParticipantStatus" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "ZooteerParticipantRole" AS ENUM ('HOST', 'PARTICIPANT');
CREATE TYPE "ZooteerRoomEventType" AS ENUM ('ROOM_CREATED', 'ROOM_CLOSED', 'ROOM_ARCHIVED');
CREATE TYPE "ZooteerAuditAction" AS ENUM ('ROOM_CREATE', 'ROOM_CLOSE', 'ROOM_ARCHIVE');

CREATE TABLE "zooteer_rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ZooteerRoomStatus" NOT NULL DEFAULT 'OPEN',
    "hostId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 20,
    "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 3600,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zooteer_rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zooteer_rooms_max_participants_range" CHECK ("maxParticipants" >= 2 AND "maxParticipants" <= 20),
    CONSTRAINT "zooteer_rooms_idle_timeout_range" CHECK ("idleTimeoutSeconds" >= 60 AND "idleTimeoutSeconds" <= 86400)
);

CREATE TABLE "zooteer_participants" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ZooteerParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "participantRole" "ZooteerParticipantRole" NOT NULL,
    "firstJoinedAt" TIMESTAMP(3) NOT NULL,
    "lastJoinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zooteer_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zooteer_room_events" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" "ZooteerRoomEventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zooteer_room_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zooteer_audit_logs" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "ZooteerAuditAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zooteer_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zooteer_rooms_deletedAt_status_createdAt_idx" ON "zooteer_rooms"("deletedAt", "status", "createdAt");
CREATE INDEX "zooteer_rooms_createdById_idx" ON "zooteer_rooms"("createdById");
CREATE INDEX "zooteer_rooms_hostId_idx" ON "zooteer_rooms"("hostId");

CREATE UNIQUE INDEX "zooteer_participants_roomId_userId_key" ON "zooteer_participants"("roomId", "userId");
CREATE INDEX "zooteer_participants_roomId_status_idx" ON "zooteer_participants"("roomId", "status");
CREATE INDEX "zooteer_participants_userId_idx" ON "zooteer_participants"("userId");

CREATE INDEX "zooteer_room_events_roomId_createdAt_idx" ON "zooteer_room_events"("roomId", "createdAt");

CREATE INDEX "zooteer_audit_logs_roomId_createdAt_idx" ON "zooteer_audit_logs"("roomId", "createdAt");
CREATE INDEX "zooteer_audit_logs_actorUserId_createdAt_idx" ON "zooteer_audit_logs"("actorUserId", "createdAt");

ALTER TABLE "zooteer_rooms" ADD CONSTRAINT "zooteer_rooms_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_rooms" ADD CONSTRAINT "zooteer_rooms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_rooms" ADD CONSTRAINT "zooteer_rooms_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_rooms" ADD CONSTRAINT "zooteer_rooms_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zooteer_participants" ADD CONSTRAINT "zooteer_participants_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "zooteer_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_participants" ADD CONSTRAINT "zooteer_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zooteer_room_events" ADD CONSTRAINT "zooteer_room_events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "zooteer_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_room_events" ADD CONSTRAINT "zooteer_room_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zooteer_audit_logs" ADD CONSTRAINT "zooteer_audit_logs_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "zooteer_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_audit_logs" ADD CONSTRAINT "zooteer_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
