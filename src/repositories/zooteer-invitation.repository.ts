import {
  ZooteerParticipantRole,
  ZooteerParticipantStatus,
  ZooteerRoomEventType,
  ZooteerRoomStatus,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../utils/response.js';
import { admissionWouldExceedCapacity } from '../services/zooteer-capacity.js';
import { expireDisconnects } from '../services/zooteer-grace.js';
import { ZooteerAuditRepository } from './zooteer-audit.repository.js';
import { ZooteerDb, ZooteerInvitationRecord, zooteerDb } from './zooteer-db.js';

const NOT_USABLE = 'Invitation not found';

export class ZooteerInvitationRepository {
  static async findById(id: string): Promise<ZooteerInvitationRecord | null> {
    return zooteerDb().zooteerInvitation.findFirst({ where: { id } });
  }

  static async findByTokenHash(
    tokenHash: string,
  ): Promise<ZooteerInvitationRecord | null> {
    return zooteerDb().zooteerInvitation.findFirst({ where: { tokenHash } });
  }

  static async listByRoom(input: {
    roomId: string;
    skip: number;
    take: number;
  }): Promise<ZooteerInvitationRecord[]> {
    return zooteerDb().zooteerInvitation.findMany({
      where: { roomId: input.roomId },
      orderBy: { createdAt: 'desc' },
      skip: input.skip,
      take: input.take,
    });
  }

  static async countByRoom(roomId: string): Promise<number> {
    return zooteerDb().zooteerInvitation.count({ where: { roomId } });
  }

  static async listByInvitee(inviteeUserId: string): Promise<ZooteerInvitationRecord[]> {
    return zooteerDb().zooteerInvitation.findMany({
      where: { inviteeUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async createWithAudit(input: {
    roomId: string;
    inviteeUserId: string;
    tokenHash: string;
    expiresAt: Date;
    actorId: string;
    now: Date;
  }): Promise<{ invitation: ZooteerInvitationRecord; roomName: string }> {
    return zooteerDb().$transaction(async (tx) => {
      await tx.lockRoom(input.roomId);
      const room = await requireOpenRoom(tx, input.roomId);
      const usable = await tx.zooteerInvitation.findFirst({
        where: {
          roomId: input.roomId,
          inviteeUserId: input.inviteeUserId,
          acceptedAt: null,
          revokedAt: null,
        },
      });
      if (usable && usable.expiresAt.getTime() > input.now.getTime()) {
        throw new ConflictError('A usable invitation already exists for this account');
      }
      if (usable) {
        await tx.zooteerInvitation.update({
          where: { id: usable.id },
          data: { revokedAt: input.now, updatedAt: input.now },
        });
        await tx.zooteerRoomEvent.create({
          data: {
            roomId: room.id,
            actorUserId: input.actorId,
            type: ZooteerRoomEventType.INVITATION_REVOKED,
            payload: { invitationId: usable.id, superseded: true },
          },
        });
        await ZooteerAuditRepository.append(tx, {
          roomId: room.id,
          actorUserId: input.actorId,
          action: 'INVITE_REVOKE',
          reason: 'Superseded by a new invitation',
          metadata: { invitationId: usable.id },
        });
      }
      const invitation = await tx.zooteerInvitation.create({
        data: {
          roomId: input.roomId,
          inviteeUserId: input.inviteeUserId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          acceptedAt: null,
          revokedAt: null,
          createdById: input.actorId,
        },
      });
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: room.id,
          actorUserId: input.actorId,
          type: ZooteerRoomEventType.INVITATION_CREATED,
          payload: {
            invitationId: invitation.id,
            expiresAt: input.expiresAt.toISOString(),
          },
        },
      });
      await ZooteerAuditRepository.append(tx, {
        roomId: room.id,
        actorUserId: input.actorId,
        action: 'INVITE_CREATE',
        metadata: { invitationId: invitation.id, inviteeUserId: input.inviteeUserId },
      });
      return { invitation, roomName: room.name };
    });
  }

  static async revoke(input: {
    roomId: string;
    invitationId: string;
    actorId: string;
    now: Date;
  }): Promise<ZooteerInvitationRecord> {
    return zooteerDb().$transaction(async (tx) => {
      await tx.lockRoom(input.roomId);
      const invitation = await tx.zooteerInvitation.findFirst({
        where: { id: input.invitationId },
      });
      if (!invitation || invitation.roomId !== input.roomId) {
        throw new NotFoundError('Invitation not found');
      }
      if (invitation.acceptedAt)
        throw new ConflictError('Invitation has already been accepted');
      if (invitation.revokedAt)
        throw new ConflictError('Invitation has already been revoked');
      const updated = await tx.zooteerInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: input.now, updatedAt: input.now },
      });
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: input.roomId,
          actorUserId: input.actorId,
          type: ZooteerRoomEventType.INVITATION_REVOKED,
          payload: { invitationId: invitation.id },
        },
      });
      await ZooteerAuditRepository.append(tx, {
        roomId: input.roomId,
        actorUserId: input.actorId,
        action: 'INVITE_REVOKE',
        metadata: { invitationId: invitation.id },
      });
      return updated;
    });
  }

  static async accept(input: {
    tokenHash: string;
    actorId: string;
    now: Date;
    eligible: boolean;
  }): Promise<{ roomId: string; participantId: string }> {
    if (!input.eligible) {
      throw new NotFoundError(NOT_USABLE);
    }
    return zooteerDb().$transaction(async (tx) => {
      const invitation = await tx.zooteerInvitation.findFirst({
        where: { tokenHash: input.tokenHash },
      });
      if (!invitation || invitation.inviteeUserId !== input.actorId) {
        throw new NotFoundError(NOT_USABLE);
      }
      await tx.lockRoom(invitation.roomId);
      await expireDisconnects(tx, invitation.roomId, input.now);
      const current = await tx.zooteerInvitation.findFirst({
        where: { id: invitation.id },
      });
      if (!current || current.inviteeUserId !== input.actorId) {
        throw new NotFoundError(NOT_USABLE);
      }
      if (current.revokedAt) throw new ConflictError('Invitation has been revoked');
      if (current.acceptedAt)
        throw new ConflictError('Invitation has already been accepted');
      if (current.expiresAt.getTime() <= input.now.getTime()) {
        throw new ConflictError('Invitation has expired');
      }
      const room = await tx.zooteerRoom.findFirst({ where: { id: current.roomId } });
      if (!room || room.deletedAt) throw new NotFoundError('Room not found');
      if (room.status !== ZooteerRoomStatus.OPEN) {
        throw new ConflictError('Closed rooms cannot accept invitations');
      }
      const active = await tx.zooteerParticipant.findMany({
        where: { roomId: room.id, status: ZooteerParticipantStatus.ACTIVE },
      });
      const existing = await tx.zooteerParticipant.findFirst({
        where: { roomId: room.id, userId: input.actorId },
      });
      if (existing?.status === ZooteerParticipantStatus.ACTIVE) {
        throw new ConflictError('Membership already exists for this room');
      }
      const activeIds = active.map((row) => row.userId);
      if (
        admissionWouldExceedCapacity(
          room.hostId,
          activeIds,
          input.actorId,
          room.maxParticipants,
        )
      ) {
        throw new ConflictError('Room is full');
      }
      const participant = existing
        ? await tx.zooteerParticipant.update({
            where: { id: existing.id },
            data: {
              status: ZooteerParticipantStatus.ACTIVE,
              lastJoinedAt: input.now,
              leftAt: null,
              disconnectedAt: null,
              updatedAt: input.now,
            },
          })
        : await tx.zooteerParticipant.create({
            data: {
              roomId: room.id,
              userId: input.actorId,
              status: ZooteerParticipantStatus.ACTIVE,
              participantRole:
                input.actorId === room.hostId
                  ? ZooteerParticipantRole.HOST
                  : ZooteerParticipantRole.PARTICIPANT,
              firstJoinedAt: input.now,
              lastJoinedAt: input.now,
              leftAt: null,
              disconnectedAt: null,
            },
          });
      await tx.zooteerInvitation.update({
        where: { id: current.id },
        data: { acceptedAt: input.now, updatedAt: input.now },
      });
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: room.id,
          actorUserId: input.actorId,
          type: ZooteerRoomEventType.INVITATION_ACCEPTED,
          payload: { invitationId: current.id, participantId: participant.id },
        },
      });
      await ZooteerAuditRepository.append(tx, {
        roomId: room.id,
        actorUserId: input.actorId,
        action: 'INVITE_ACCEPT',
        metadata: { invitationId: current.id, participantId: participant.id },
      });
      return { roomId: room.id, participantId: participant.id };
    });
  }
}

async function requireOpenRoom(tx: ZooteerDb, roomId: string) {
  const room = await tx.zooteerRoom.findFirst({ where: { id: roomId } });
  if (!room || room.deletedAt) throw new NotFoundError('Room not found');
  if (room.status !== ZooteerRoomStatus.OPEN) {
    throw new ConflictError('Room is closed');
  }
  return room;
}
