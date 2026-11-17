import { Role, ZooteerParticipantStatus, ZooteerRoomStatus } from '@prisma/client';
import { ZooteerInvitationRepository } from '../repositories/zooteer-invitation.repository.js';
import { ZooteerParticipantRepository } from '../repositories/zooteer-participant.repository.js';
import { zooteerDb } from '../repositories/zooteer-db.js';
import { ZooteerRoomRepository } from '../repositories/zooteer-room.repository.js';
import { AppError, ConflictError, NotFoundError } from '../utils/response.js';
import { admissionWouldExceedCapacity } from './zooteer-capacity.js';
import {
  invitationState,
  ZooteerInvitationService,
} from './zooteer-invitation.service.js';
import { findZooteerInvitee } from './zooteer-invitee.js';
import { normalizeRoomCode } from './zooteer-room-code.js';

export type ZooteerAccessState =
  | 'valid'
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'invalid'
  | 'full'
  | 'closed'
  | 'not_invited';

export interface ZooteerAccessResult {
  state: ZooteerAccessState;
  roomId: string | null;
  participantId: string | null;
  roomName: string | null;
  code: string | null;
}

const EMPTY: ZooteerAccessResult = {
  state: 'invalid',
  roomId: null,
  participantId: null,
  roomName: null,
  code: null,
};

function fromError(error: unknown): ZooteerAccessState | null {
  if (
    !(error instanceof ConflictError) &&
    !(error instanceof NotFoundError) &&
    !(error instanceof AppError)
  ) {
    return null;
  }
  const message = error.message.toLowerCase();
  if (message.includes('full')) return 'full';
  if (message.includes('closed')) return 'closed';
  if (message.includes('expired')) return 'expired';
  if (message.includes('revoked')) return 'revoked';
  if (message.includes('not found')) return 'invalid';
  return null;
}

export class ZooteerAccessService {
  static async enter(actorId: string, rawCode: string): Promise<ZooteerAccessResult> {
    const trimmed = rawCode.trim();
    const roomCode = normalizeRoomCode(trimmed);
    if (roomCode && trimmed.length === 8) return enterRoomCode(actorId, roomCode);
    try {
      const accepted = await ZooteerInvitationService.accept(
        { id: actorId, role: Role.CREATOR },
        { token: trimmed },
      );
      const room = await ZooteerRoomRepository.findById(accepted.roomId);
      return {
        state: accepted.rejoined ? 'accepted' : 'valid',
        roomId: accepted.roomId,
        participantId: accepted.participantId,
        roomName: room?.name ?? null,
        code: room?.code ?? null,
      };
    } catch (error) {
      const state = fromError(error);
      if (!state) throw error;
      return { ...EMPTY, state };
    }
  }

  static async inbox(actorId: string) {
    const rows = await ZooteerInvitationRepository.listByInvitee(actorId);
    const items = [];
    for (const row of rows.slice(0, 50)) {
      const room = await ZooteerRoomRepository.findById(row.roomId);
      if (!room) continue;
      items.push({
        id: row.id,
        roomId: room.id,
        roomName: room.name,
        code: room.code,
        roomStatus: room.status,
        state: invitationState(row),
        expiresAt: row.expiresAt.toISOString(),
      });
    }
    return items;
  }
}

async function enterRoomCode(
  actorId: string,
  code: string,
): Promise<ZooteerAccessResult> {
  const room = await ZooteerRoomRepository.findByCode(code);
  if (!room) return { ...EMPTY, state: 'invalid' };
  const named = {
    roomName: room.name,
    code: room.code,
    roomId: null,
    participantId: null,
  };
  if (room.deletedAt || room.status !== ZooteerRoomStatus.OPEN) {
    return { ...named, state: 'closed' };
  }
  const invitee = await findZooteerInvitee(actorId);
  if (!invitee || invitee.accountStatus === 'BLOCKED' || !invitee.emailVerifiedAt) {
    return { ...named, state: 'not_invited' };
  }
  const [invitations, member, active] = await Promise.all([
    zooteerDb().zooteerInvitation.findMany({
      where: { roomId: room.id, inviteeUserId: actorId },
      orderBy: { createdAt: 'desc' },
    }),
    zooteerDb().zooteerParticipant.findFirst({
      where: { roomId: room.id, userId: actorId },
    }),
    zooteerDb().zooteerParticipant.findMany({
      where: { roomId: room.id, status: ZooteerParticipantStatus.ACTIVE },
    }),
  ]);
  const pending = invitations.some((row) => invitationState(row) === 'active');
  const accepted = invitations.some((row) => Boolean(row.acceptedAt));
  const seated = member?.status === ZooteerParticipantStatus.ACTIVE;
  if (
    !seated &&
    admissionWouldExceedCapacity(
      room.hostId,
      active.map((row) => row.userId),
      actorId,
      room.maxParticipants,
    ) &&
    (pending || accepted || member)
  ) {
    return { ...named, state: 'full' };
  }
  if (seated && !pending) {
    return {
      state: 'accepted',
      roomId: room.id,
      participantId: member.id,
      roomName: room.name,
      code: room.code,
    };
  }
  if (!pending && !accepted && member?.status === ZooteerParticipantStatus.LEFT) {
    const updated = await ZooteerParticipantRepository.update(room.id, actorId, {
      status: ZooteerParticipantStatus.ACTIVE,
      lastJoinedAt: new Date(),
      leftAt: null,
      disconnectedAt: null,
    });
    return {
      state: 'accepted',
      roomId: room.id,
      participantId: updated.id,
      roomName: room.name,
      code: room.code,
    };
  }
  if (!pending && !accepted) {
    if (invitations.some((row) => invitationState(row) === 'revoked')) {
      return { ...named, state: 'revoked' };
    }
    if (invitations.some((row) => invitationState(row) === 'expired')) {
      return { ...named, state: 'expired' };
    }
    return { ...named, state: 'not_invited' };
  }
  try {
    const result = await ZooteerInvitationRepository.acceptOwned({
      roomId: room.id,
      actorId,
      now: new Date(),
    });
    return {
      state: result.rejoined ? 'accepted' : 'pending',
      roomId: result.roomId,
      participantId: result.participantId,
      roomName: room.name,
      code: room.code,
    };
  } catch (error) {
    const state = fromError(error);
    if (!state) throw error;
    return { ...named, state };
  }
}
