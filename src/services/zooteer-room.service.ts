import { Role, ZooteerRoomStatus } from '@prisma/client';
import { parsePaginationParams } from '../utils/pagination.js';
import { ForbiddenError, NotFoundError } from '../utils/response.js';
import {
  CreateZooteerRoomInput,
  ListZooteerRoomsQuery,
  UpdateZooteerRoomInput,
} from '../schemas/zooteer-room.schema.js';
import { ZooteerParticipantRepository } from '../repositories/zooteer-participant.repository.js';
import { ZooteerParticipantRecord } from '../repositories/zooteer-db.js';
import { ZooteerRoomRepository } from '../repositories/zooteer-room.repository.js';
import { occupiedSeatCount } from './zooteer-capacity.js';
import { cleanupLiveKitRoom } from './zooteer-media.service.js';

export interface ZooteerActor {
  id: string;
  role: Role;
}

export interface ZooteerRoomView {
  id: string;
  name: string;
  description: string | null;
  status: ZooteerRoomStatus;
  hostId: string;
  createdById: string;
  maxParticipants: number;
  idleTimeoutSeconds: number;
  activeParticipantCount: number;
  closedAt: string | null;
  closedById: string | null;
  createdAt: string;
  updatedAt: string;
}

function assertAdmin(actor: ZooteerActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError('Admin authorization is required');
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export class ZooteerRoomService {
  static async create(
    actor: ZooteerActor,
    input: CreateZooteerRoomInput,
  ): Promise<ZooteerRoomView> {
    assertAdmin(actor);
    const room = await ZooteerRoomRepository.create({
      name: input.name.trim(),
      description: blankToNull(input.description),
      maxParticipants: input.maxParticipants,
      idleTimeoutSeconds: input.idleTimeoutSeconds,
      actorId: actor.id,
    });
    return toView(room, occupiedSeatCount(room.hostId, [room.hostId]));
  }

  static async list(actor: ZooteerActor, query: ListZooteerRoomsQuery) {
    assertAdmin(actor);
    const { page, limit, skip } = parsePaginationParams(query);
    const [rooms, totalCount] = await Promise.all([
      ZooteerRoomRepository.list({ status: query.status, skip, take: limit }),
      ZooteerRoomRepository.count(query.status),
    ]);
    const grouped = await ZooteerParticipantRepository.listActiveUserIdsForRooms(
      rooms.map((room) => room.id),
    );
    return {
      items: rooms.map((room) =>
        toView(room, occupiedSeatCount(room.hostId, grouped.get(room.id) ?? [])),
      ),
      totalCount,
      page,
      limit,
    };
  }

  static async get(actor: ZooteerActor, roomId: string): Promise<ZooteerRoomView> {
    assertAdmin(actor);
    const room = await ZooteerRoomRepository.findById(roomId);
    if (!room) throw new NotFoundError('Room not found');
    return toView(room, await seatCount(room));
  }

  static async close(
    actor: ZooteerActor,
    roomId: string,
    reason?: string,
  ): Promise<ZooteerRoomView> {
    assertAdmin(actor);
    const room = await ZooteerRoomRepository.close(roomId, actor.id, reason ?? null);
    await cleanupLiveKitRoom(room);
    return toView(room, await seatCount(room));
  }

  /** Not routed in PZ-M02. Archive is a separate action from close. */
  static async archive(
    actor: ZooteerActor,
    roomId: string,
    reason?: string,
  ): Promise<ZooteerRoomView> {
    assertAdmin(actor);
    const room = await ZooteerRoomRepository.archive(roomId, actor.id, reason ?? null);
    return toView(room, await seatCount(room));
  }

  static async updateMetadata(
    actor: ZooteerActor,
    roomId: string,
    input: UpdateZooteerRoomInput,
  ): Promise<ZooteerRoomView> {
    assertAdmin(actor);
    const room = await ZooteerRoomRepository.updateMetadata(roomId, {
      ...input,
      description:
        input.description === undefined ? undefined : blankToNull(input.description),
    });
    return toView(room, await seatCount(room));
  }

  static async listParticipants(
    actor: ZooteerActor,
    roomId: string,
  ): Promise<ZooteerParticipantRecord[]> {
    assertAdmin(actor);
    return ZooteerParticipantRepository.listByRoom(roomId);
  }
}

async function seatCount(room: { id: string; hostId: string }): Promise<number> {
  const ids = await ZooteerParticipantRepository.listActiveUserIds(room.id);
  return occupiedSeatCount(room.hostId, ids);
}

function toView(
  room: {
    id: string;
    name: string;
    description: string | null;
    status: ZooteerRoomStatus;
    hostId: string;
    createdById: string;
    maxParticipants: number;
    idleTimeoutSeconds: number;
    closedAt: Date | null;
    closedById: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  activeParticipantCount: number,
): ZooteerRoomView {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    status: room.status,
    hostId: room.hostId,
    createdById: room.createdById,
    maxParticipants: room.maxParticipants,
    idleTimeoutSeconds: room.idleTimeoutSeconds,
    activeParticipantCount,
    closedAt: room.closedAt ? room.closedAt.toISOString() : null,
    closedById: room.closedById,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}
