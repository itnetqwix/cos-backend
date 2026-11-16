import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  acceptZooteerInvitationSchema,
  createZooteerInvitationSchema,
  listZooteerInvitationsQuerySchema,
  zooteerInvitationParamsSchema,
} from '../schemas/zooteer-invitation.schema.js';
import { zooteerRoomIdParamSchema } from '../schemas/zooteer-room.schema.js';
import { ZooteerInvitationService } from '../services/zooteer-invitation.service.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function actor(request: FastifyRequest) {
  return { id: request.user.id, role: request.user.role };
}

export class ZooteerInvitationController {
  static async create(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const body = createZooteerInvitationSchema.parse(request.body ?? {});
    const result = await ZooteerInvitationService.create(actor(request), roomId, body);
    return sendSuccess(reply, result, 'Invitation created', HTTP_STATUS.CREATED);
  }

  static async list(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const query = listZooteerInvitationsQuerySchema.parse(request.query ?? {});
    const result = await ZooteerInvitationService.list(actor(request), roomId, query);
    return sendPaginated(
      reply,
      result.items,
      result.totalCount,
      result.page,
      result.limit,
      'Invitations retrieved successfully',
    );
  }

  static async revoke(request: FastifyRequest, reply: FastifyReply) {
    const { roomId, invitationId } = zooteerInvitationParamsSchema.parse(request.params);
    const invitation = await ZooteerInvitationService.revoke(
      actor(request),
      roomId,
      invitationId,
    );
    return sendSuccess(reply, invitation, 'Invitation revoked');
  }

  static async accept(request: FastifyRequest, reply: FastifyReply) {
    const body = acceptZooteerInvitationSchema.parse(request.body ?? {});
    const result = await ZooteerInvitationService.accept(actor(request), body);
    return sendSuccess(reply, result, 'Invitation accepted');
  }
}
