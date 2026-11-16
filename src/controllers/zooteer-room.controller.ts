import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { ZooteerParticipantRecord } from '../repositories/zooteer-db.js';
import {
  closeZooteerRoomSchema,
  createZooteerRoomSchema,
  listZooteerRoomsQuerySchema,
  zooteerRoomIdParamSchema,
} from '../schemas/zooteer-room.schema.js';
import { ZooteerRoomService } from '../services/zooteer-room.service.js';
import { retryProviderCleanup } from '../services/zooteer-media.service.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function actor(request: FastifyRequest) {
  return { id: request.user.id, role: request.user.role };
}

function iso(value: Date): string {
  return value.toISOString();
}

function toParticipant(row: ZooteerParticipantRecord) {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    status: row.status,
    participantRole: row.participantRole,
    firstJoinedAt: iso(row.firstJoinedAt),
    lastJoinedAt: iso(row.lastJoinedAt),
    leftAt: row.leftAt ? iso(row.leftAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export class ZooteerRoomController {
  static async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createZooteerRoomSchema.parse(request.body ?? {});
    const room = await ZooteerRoomService.create(actor(request), body);
    return sendSuccess(reply, room, 'Room created', HTTP_STATUS.CREATED);
  }

  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listZooteerRoomsQuerySchema.parse(request.query ?? {});
    const result = await ZooteerRoomService.list(actor(request), query);
    return sendPaginated(
      reply,
      result.items,
      result.totalCount,
      result.page,
      result.limit,
      'Rooms retrieved successfully',
    );
  }

  static async get(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const room = await ZooteerRoomService.get(actor(request), roomId);
    return sendSuccess(reply, room, 'Room retrieved successfully');
  }

  static async close(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const body = closeZooteerRoomSchema.parse(request.body ?? {});
    const room = await ZooteerRoomService.close(actor(request), roomId, body.reason);
    return sendSuccess(reply, room, 'Room closed');
  }

  static async participants(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const rows = await ZooteerRoomService.listParticipants(actor(request), roomId);
    return sendSuccess(
      reply,
      rows.map(toParticipant),
      'Participants retrieved successfully',
    );
  }

  static async retryCleanup(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const result = await retryProviderCleanup(actor(request), roomId);
    return sendSuccess(reply, result, 'Room reconciliation finished');
  }
}
