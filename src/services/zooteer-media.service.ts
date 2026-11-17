import {
  Role,
  ZooteerParticipantStatus,
  ZooteerRoomEventType,
  ZooteerRoomStatus,
} from '@prisma/client';
import { HTTP_STATUS } from '../config/constants.js';
import { ZooteerAuditRepository } from '../repositories/zooteer-audit.repository.js';
import { ZooteerRoomRecord, zooteerDb } from '../repositories/zooteer-db.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { CREATOR_BLOCKED_MESSAGE } from './creator-account.service.js';
import { findZooteerInvitee } from './zooteer-invitee.js';
import { expireDisconnects } from './zooteer-grace.js';
import {
  activeLiveKitGateway,
  generateLiveKitRoomName,
  liveKitSettings,
  mediaAccessConfigured,
  VerifiedMediaWebhook,
} from './zooteer-livekit.js';

const NOT_A_PARTICIPANT = 'You are not a participant in this room';

/** Status only. The provider message can echo request details, so it is not logged. */
export function liveKitErrorCategory(error: unknown): string {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 0;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 408 || (error instanceof Error && error.name === 'TimeoutError'))
    return 'timeout';
  if (status >= 500) return 'provider';
  return 'unavailable';
}

export async function issueMediaToken(
  userId: string,
  roomId: string,
): Promise<{ url: string; token: string }> {
  if (!mediaAccessConfigured()) {
    throw new AppError('LiveKit is not configured', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  const invitee = await findZooteerInvitee(userId);
  if (!invitee) throw new ForbiddenError(NOT_A_PARTICIPANT);
  if (invitee.accountStatus === 'BLOCKED')
    throw new ForbiddenError(CREATOR_BLOCKED_MESSAGE);
  if (!invitee.emailVerifiedAt)
    throw new ForbiddenError('Email verification is required');

  const now = new Date();
  await zooteerDb().$transaction(async (tx) => {
    await tx.lockRoom(roomId);
    await expireDisconnects(tx, roomId, now);
  });
  const prepared = await zooteerDb().$transaction(async (tx) => {
    await tx.lockRoom(roomId);
    const room = await tx.zooteerRoom.findFirst({ where: { id: roomId } });
    if (!room || room.deletedAt) throw new NotFoundError('Room not found');
    if (room.status !== ZooteerRoomStatus.OPEN) throw new ConflictError('Room is closed');
    const member = await tx.zooteerParticipant.findFirst({ where: { roomId, userId } });
    if (!member || member.status !== ZooteerParticipantStatus.ACTIVE) {
      throw new ForbiddenError(NOT_A_PARTICIPANT);
    }
    let providerRoom = room.livekitRoomName;
    if (!providerRoom) {
      providerRoom = generateLiveKitRoomName();
      await tx.zooteerRoom.update({
        where: { id: room.id },
        data: { livekitRoomName: providerRoom, updatedAt: now },
      });
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: room.id,
          actorUserId: userId,
          type: ZooteerRoomEventType.MEDIA_PROVISIONED,
          payload: { providerRoom },
        },
      });
    }
    return {
      providerRoom,
      maxParticipants: room.maxParticipants,
      name: invitee.name,
      participantId: member.id,
    };
  });

  const gateway = activeLiveKitGateway();
  let operation: 'createRoom' | 'issueToken' = 'createRoom';
  try {
    await gateway.createRoom(prepared.providerRoom, prepared.maxParticipants);
    operation = 'issueToken';
    const token = await gateway.issueToken({
      identity: userId,
      name: prepared.name,
      room: prepared.providerRoom,
      ttlSeconds: liveKitSettings()?.ttlSeconds ?? 600,
    });
    try {
      await ZooteerAuditRepository.append(zooteerDb(), {
        roomId,
        actorUserId: userId,
        action: 'MEDIA_TOKEN',
        metadata: { participantId: prepared.participantId },
      });
    } catch {
      // Token was already issued. The audit row is best-effort.
    }
    return { url: gateway.url, token };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error(
      `LiveKit media token failed operation=${operation} category=${liveKitErrorCategory(error)}`,
    );
    throw new AppError('LiveKit is unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}

export async function cleanupLiveKitRoom(room: ZooteerRoomRecord): Promise<void> {
  if (!room.livekitRoomName) return;
  try {
    await activeLiveKitGateway().deleteRoom(room.livekitRoomName);
    await ZooteerAuditRepository.append(zooteerDb(), {
      roomId: room.id,
      actorUserId: room.closedById ?? room.hostId,
      action: 'MEDIA_CLEANUP',
      metadata: { ok: true },
    });
  } catch {
    try {
      await ZooteerAuditRepository.append(zooteerDb(), {
        roomId: room.id,
        actorUserId: room.closedById ?? room.hostId,
        action: 'MEDIA_CLEANUP',
        metadata: { ok: false },
      });
    } catch {
      // The room row is already closed. Cleanup status is best-effort.
    }
  }
}

export async function retryProviderCleanup(
  actor: { id: string; role: Role },
  roomId: string,
): Promise<{ roomStatus: ZooteerRoomStatus; providerCleanup: 'ok' | 'skipped' }> {
  if (actor.role !== Role.ADMIN)
    throw new ForbiddenError('Admin authorization is required');
  const room = await zooteerDb().zooteerRoom.findFirst({
    where: { id: roomId, deletedAt: null },
  });
  if (!room) throw new NotFoundError('Room not found');
  await zooteerDb().$transaction(async (tx) => {
    await tx.lockRoom(roomId);
    await expireDisconnects(tx, roomId, new Date());
  });
  if (room.status !== ZooteerRoomStatus.CLOSED || !room.livekitRoomName) {
    return { roomStatus: room.status, providerCleanup: 'skipped' };
  }
  try {
    await activeLiveKitGateway().deleteRoom(room.livekitRoomName);
  } catch {
    try {
      await ZooteerAuditRepository.append(zooteerDb(), {
        roomId: room.id,
        actorUserId: actor.id,
        action: 'MEDIA_CLEANUP',
        metadata: { ok: false, retry: true },
      });
    } catch {
      // The room row stays closed either way.
    }
    throw new AppError(
      'Provider cleanup failed. The room stays closed.',
      HTTP_STATUS.SERVICE_UNAVAILABLE,
    );
  }
  await ZooteerAuditRepository.append(zooteerDb(), {
    roomId: room.id,
    actorUserId: actor.id,
    action: 'MEDIA_CLEANUP',
    metadata: { ok: true, retry: true },
  });
  const current = await zooteerDb().zooteerRoom.findFirst({ where: { id: roomId } });
  return { roomStatus: current?.status ?? room.status, providerCleanup: 'ok' };
}

export async function applyMediaWebhook(
  event: VerifiedMediaWebhook,
): Promise<{ ignored: boolean }> {
  const room = await zooteerDb().zooteerRoom.findFirst({
    where: { livekitRoomName: event.roomName },
  });
  if (!room) return { ignored: true };
  const member = await zooteerDb().zooteerParticipant.findFirst({
    where: { roomId: room.id, userId: event.identity },
  });
  if (!member) return { ignored: true };
  if (member.status !== ZooteerParticipantStatus.ACTIVE) return { ignored: true };

  const leave =
    event.event === 'participant_left' ||
    event.event === 'participant_connection_aborted';
  if (leave) {
    if (member.lastJoinedAt.getTime() > event.occurredAt.getTime())
      return { ignored: true };
    if (
      member.disconnectedAt &&
      member.disconnectedAt.getTime() >= event.occurredAt.getTime()
    ) {
      return { ignored: true };
    }
    await zooteerDb().zooteerParticipant.update({
      where: { id: member.id },
      data: { disconnectedAt: event.occurredAt, updatedAt: new Date() },
    });
    await zooteerDb().zooteerRoomEvent.create({
      data: {
        roomId: room.id,
        actorUserId: event.identity,
        type: ZooteerRoomEventType.PARTICIPANT_DISCONNECTED,
        payload: { at: event.occurredAt.toISOString() },
      },
    });
    return { ignored: false };
  }

  if (event.event === 'participant_joined') {
    await zooteerDb().zooteerParticipant.update({
      where: { id: member.id },
      data: {
        disconnectedAt: null,
        lastJoinedAt: event.occurredAt,
        updatedAt: new Date(),
      },
    });
    await zooteerDb().zooteerRoomEvent.create({
      data: {
        roomId: room.id,
        actorUserId: event.identity,
        type: ZooteerRoomEventType.PARTICIPANT_RECONNECTED,
        payload: { at: event.occurredAt.toISOString() },
      },
    });
    return { ignored: false };
  }
  return { ignored: true };
}

export async function receiveMediaWebhook(
  body: string,
  authorization: string | undefined,
) {
  let event: VerifiedMediaWebhook | null;
  try {
    event = await activeLiveKitGateway().verifyWebhook(body, authorization);
  } catch {
    throw new UnauthorizedError('Invalid LiveKit webhook signature');
  }
  if (!event) return { ignored: true };
  return applyMediaWebhook(event);
}
