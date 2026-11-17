import {
  ZooteerParticipantRole,
  ZooteerParticipantStatus,
  ZooteerRoomEventType,
  ZooteerRoomStatus,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../utils/response.js';
import { generateRoomCode } from '../services/zooteer-room-code.js';
import { assertIdleTimeout, assertRoomCapacity } from '../services/zooteer-room-rules.js';
import { ZooteerAuditRepository } from './zooteer-audit.repository.js';
import { ZooteerDb, ZooteerRoomRecord, zooteerDb } from './zooteer-db.js';

const visible = { deletedAt: null as null };

export interface CreateZooteerRoomData {
  name: string;
  description: string | null;
  maxParticipants: number;
  idleTimeoutSeconds: number;
  actorId: string;
}

export interface UpdateZooteerRoomData {
  name?: string;
  description?: string | null;
  maxParticipants?: number;
  idleTimeoutSeconds?: number;
}

async function insertRoom(
  input: CreateZooteerRoomData,
  code: string,
): Promise<ZooteerRoomRecord> {
  return zooteerDb().$transaction(async (tx) => {
    const room = await tx.zooteerRoom.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        status: ZooteerRoomStatus.OPEN,
        hostId: input.actorId,
        createdById: input.actorId,
        maxParticipants: input.maxParticipants,
        idleTimeoutSeconds: input.idleTimeoutSeconds,
        closedAt: null,
        closedById: null,
        deletedAt: null,
        deletedById: null,
        livekitRoomName: null,
      },
    });
    const joinedAt = new Date();
    await tx.zooteerParticipant.create({
      data: {
        roomId: room.id,
        userId: input.actorId,
        status: ZooteerParticipantStatus.ACTIVE,
        participantRole: ZooteerParticipantRole.HOST,
        firstJoinedAt: joinedAt,
        lastJoinedAt: joinedAt,
        leftAt: null,
        disconnectedAt: null,
      },
    });
    await tx.zooteerRoomEvent.create({
      data: {
        roomId: room.id,
        actorUserId: input.actorId,
        type: ZooteerRoomEventType.ROOM_CREATED,
        payload: { name: room.name, maxParticipants: room.maxParticipants },
      },
    });
    await ZooteerAuditRepository.append(tx, {
      roomId: room.id,
      actorUserId: input.actorId,
      action: 'ROOM_CREATE',
      metadata: {
        maxParticipants: room.maxParticipants,
        idleTimeoutSeconds: room.idleTimeoutSeconds,
      },
    });
    return room;
  });
}

function isUniqueCode(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export class ZooteerRoomRepository {
  static async create(input: CreateZooteerRoomData): Promise<ZooteerRoomRecord> {
    assertRoomCapacity(input.maxParticipants);
    assertIdleTimeout(input.idleTimeoutSeconds);
    let last: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await insertRoom(input, generateRoomCode());
      } catch (error) {
        last = error;
        if (!isUniqueCode(error)) throw error;
      }
    }
    throw last instanceof Error
      ? last
      : new ConflictError('Room code could not be allocated');
  }

  static async findByCode(code: string): Promise<ZooteerRoomRecord | null> {
    return zooteerDb().zooteerRoom.findFirst({
      where: { code, ...visible },
    });
  }

  static async findById(
    id: string,
    includeDeleted = false,
  ): Promise<ZooteerRoomRecord | null> {
    return zooteerDb().zooteerRoom.findFirst({
      where: includeDeleted ? { id } : { id, ...visible },
    });
  }

  static async list(input: {
    status?: ZooteerRoomStatus;
    skip: number;
    take: number;
  }): Promise<ZooteerRoomRecord[]> {
    return zooteerDb().zooteerRoom.findMany({
      where: input.status ? { ...visible, status: input.status } : visible,
      orderBy: { createdAt: 'desc' },
      skip: input.skip,
      take: input.take,
    });
  }

  static async count(status?: ZooteerRoomStatus): Promise<number> {
    return zooteerDb().zooteerRoom.count({
      where: status ? { ...visible, status } : visible,
    });
  }

  /**
   * Metadata only. Status is not writable here.
   * Closed and archived rooms reject the update.
   */
  static async updateMetadata(
    id: string,
    data: UpdateZooteerRoomData,
  ): Promise<ZooteerRoomRecord> {
    if (data.maxParticipants !== undefined) assertRoomCapacity(data.maxParticipants);
    if (data.idleTimeoutSeconds !== undefined) assertIdleTimeout(data.idleTimeoutSeconds);
    return zooteerDb().$transaction(async (tx) => {
      const room = await requireOpenRoom(tx, id);
      return tx.zooteerRoom.update({
        where: { id: room.id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Second close is a conflict, matching contest transition errors.
   * It is not a no-op success.
   */
  static async close(
    id: string,
    actorId: string,
    reason?: string | null,
  ): Promise<ZooteerRoomRecord> {
    return zooteerDb().$transaction(async (tx) => {
      const existing = await tx.zooteerRoom.findFirst({ where: { id, ...visible } });
      if (!existing) throw new NotFoundError('Room not found');
      if (existing.status === ZooteerRoomStatus.CLOSED) {
        throw new ConflictError('Room is already closed');
      }
      const now = new Date();
      const updated = await tx.zooteerRoom.updateMany({
        where: { id, status: ZooteerRoomStatus.OPEN, ...visible },
        data: {
          status: ZooteerRoomStatus.CLOSED,
          closedAt: now,
          closedById: actorId,
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new ConflictError('Room is already closed');
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: id,
          actorUserId: actorId,
          type: ZooteerRoomEventType.ROOM_CLOSED,
          payload: { closedAt: now.toISOString() },
        },
      });
      await ZooteerAuditRepository.append(tx, {
        roomId: id,
        actorUserId: actorId,
        action: 'ROOM_CLOSE',
        reason: reason ?? null,
      });
      const room = await tx.zooteerRoom.findFirst({ where: { id } });
      if (!room) throw new NotFoundError('Room not found');
      return room;
    });
  }

  /**
   * Separate from close. No HTTP route in PZ-M02.
   * The row, participants, events, and audit rows stay.
   */
  static async archive(
    id: string,
    actorId: string,
    reason?: string | null,
  ): Promise<ZooteerRoomRecord> {
    return zooteerDb().$transaction(async (tx) => {
      const existing = await tx.zooteerRoom.findFirst({ where: { id } });
      if (!existing || existing.deletedAt) throw new NotFoundError('Room not found');
      const now = new Date();
      const updated = await tx.zooteerRoom.updateMany({
        where: { id, ...visible },
        data: { deletedAt: now, deletedById: actorId, updatedAt: now },
      });
      if (updated.count !== 1) throw new NotFoundError('Room not found');
      await tx.zooteerRoomEvent.create({
        data: {
          roomId: id,
          actorUserId: actorId,
          type: ZooteerRoomEventType.ROOM_ARCHIVED,
          payload: { deletedAt: now.toISOString() },
        },
      });
      await ZooteerAuditRepository.append(tx, {
        roomId: id,
        actorUserId: actorId,
        action: 'ROOM_ARCHIVE',
        reason: reason ?? null,
      });
      const room = await tx.zooteerRoom.findFirst({ where: { id } });
      if (!room) throw new NotFoundError('Room not found');
      return room;
    });
  }
}

async function requireOpenRoom(tx: ZooteerDb, id: string): Promise<ZooteerRoomRecord> {
  const room = await tx.zooteerRoom.findFirst({ where: { id, ...visible } });
  if (!room) throw new NotFoundError('Room not found');
  if (room.status !== ZooteerRoomStatus.OPEN) {
    throw new ConflictError('Closed rooms cannot be changed');
  }
  return room;
}
