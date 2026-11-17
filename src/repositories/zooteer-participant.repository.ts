import {
  ZooteerParticipantRole,
  ZooteerParticipantStatus,
  ZooteerRoomStatus,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../utils/response.js';
import { ZooteerParticipantRecord, zooteerDb } from './zooteer-db.js';

export interface CreateMembershipData {
  roomId: string;
  userId: string;
  participantRole: ZooteerParticipantRole;
  at?: Date;
}

export class ZooteerParticipantRepository {
  static async findByRoomAndUser(
    roomId: string,
    userId: string,
  ): Promise<ZooteerParticipantRecord | null> {
    return zooteerDb().zooteerParticipant.findFirst({ where: { roomId, userId } });
  }

  static async listByRoom(roomId: string): Promise<ZooteerParticipantRecord[]> {
    await requireVisibleRoom(roomId);
    return zooteerDb().zooteerParticipant.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async create(input: CreateMembershipData): Promise<ZooteerParticipantRecord> {
    await requireOpenRoom(input.roomId);
    const existing = await this.findByRoomAndUser(input.roomId, input.userId);
    if (existing) throw new ConflictError('Membership already exists for this room');
    const at = input.at ?? new Date();
    return zooteerDb().zooteerParticipant.create({
      data: {
        roomId: input.roomId,
        userId: input.userId,
        status: ZooteerParticipantStatus.ACTIVE,
        participantRole: input.participantRole,
        firstJoinedAt: at,
        lastJoinedAt: at,
        leftAt: null,
        disconnectedAt: null,
      },
    });
  }

  static async update(
    roomId: string,
    userId: string,
    data: {
      status?: ZooteerParticipantStatus;
      participantRole?: ZooteerParticipantRole;
      lastJoinedAt?: Date;
      leftAt?: Date | null;
      disconnectedAt?: Date | null;
    },
  ): Promise<ZooteerParticipantRecord> {
    await requireOpenRoom(roomId);
    const existing = await this.findByRoomAndUser(roomId, userId);
    if (!existing) throw new NotFoundError('Membership not found');
    return zooteerDb().zooteerParticipant.update({
      where: { id: existing.id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  static async markLeft(
    roomId: string,
    userId: string,
    at = new Date(),
  ): Promise<ZooteerParticipantRecord> {
    const existing = await this.findByRoomAndUser(roomId, userId);
    if (!existing) throw new NotFoundError('Membership not found');
    if (existing.status === ZooteerParticipantStatus.LEFT) return existing;
    return this.update(roomId, userId, {
      status: ZooteerParticipantStatus.LEFT,
      leftAt: at,
    });
  }

  static async countActive(roomId: string): Promise<number> {
    return zooteerDb().zooteerParticipant.count({
      where: { roomId, status: ZooteerParticipantStatus.ACTIVE },
    });
  }

  static async listActiveUserIds(roomId: string): Promise<string[]> {
    const rows = await zooteerDb().zooteerParticipant.findMany({
      where: { roomId, status: ZooteerParticipantStatus.ACTIVE },
    });
    return rows.map((row) => row.userId);
  }

  static async listActiveUserIdsForRooms(
    roomIds: string[],
  ): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (roomIds.length === 0) return grouped;
    const rows = await zooteerDb().zooteerParticipant.findMany({
      where: { roomId: { in: roomIds }, status: ZooteerParticipantStatus.ACTIVE },
    });
    for (const row of rows) {
      const list = grouped.get(row.roomId) ?? [];
      list.push(row.userId);
      grouped.set(row.roomId, list);
    }
    return grouped;
  }

  static async countActiveForRooms(roomIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (roomIds.length === 0) return counts;
    const rows = await zooteerDb().zooteerParticipant.findMany({
      where: { roomId: { in: roomIds }, status: ZooteerParticipantStatus.ACTIVE },
    });
    for (const row of rows) {
      counts.set(row.roomId, (counts.get(row.roomId) ?? 0) + 1);
    }
    return counts;
  }
}

async function requireVisibleRoom(roomId: string) {
  const room = await zooteerDb().zooteerRoom.findFirst({
    where: { id: roomId, deletedAt: null },
  });
  if (!room) throw new NotFoundError('Room not found');
  return room;
}

async function requireOpenRoom(roomId: string) {
  const room = await requireVisibleRoom(roomId);
  if (room.status !== ZooteerRoomStatus.OPEN) {
    throw new ConflictError('Closed rooms cannot change membership');
  }
  return room;
}
