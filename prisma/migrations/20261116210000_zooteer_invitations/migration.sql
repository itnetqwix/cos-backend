-- PZ-M03 Planet Zooteer invitations.
-- Additive. Does not apply by itself. Do not run against production.
-- Raw invitation tokens are not a column. Only tokenHash is stored.

ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'INVITATION_CREATED';
ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'INVITATION_REVOKED';
ALTER TYPE "ZooteerRoomEventType" ADD VALUE 'INVITATION_ACCEPTED';

ALTER TYPE "ZooteerAuditAction" ADD VALUE 'INVITE_CREATE';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'INVITE_REVOKE';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'INVITE_ACCEPT';
ALTER TYPE "ZooteerAuditAction" ADD VALUE 'INVITE_EMAIL';

CREATE TABLE "zooteer_invitations" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inviteeUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zooteer_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zooteer_invitations_tokenHash_key" ON "zooteer_invitations"("tokenHash");
CREATE INDEX "zooteer_invitations_roomId_createdAt_idx" ON "zooteer_invitations"("roomId", "createdAt");
CREATE INDEX "zooteer_invitations_inviteeUserId_expiresAt_idx" ON "zooteer_invitations"("inviteeUserId", "expiresAt");

-- One unaccepted, unrevoked invitation per room and user.
-- Expired rows stay until revoked or superseded so history is kept.
-- now() cannot be used in an index predicate, so expiry is checked in the service.
CREATE UNIQUE INDEX "zooteer_invitations_one_usable"
    ON "zooteer_invitations"("roomId", "inviteeUserId")
    WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "zooteer_invitations" ADD CONSTRAINT "zooteer_invitations_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "zooteer_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_invitations" ADD CONSTRAINT "zooteer_invitations_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zooteer_invitations" ADD CONSTRAINT "zooteer_invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
