import { FastifyReply, FastifyRequest } from 'fastify';
import { zooteerRoomIdParamSchema } from '../schemas/zooteer-room.schema.js';
import {
  issueMediaToken,
  receiveMediaWebhook,
} from '../services/zooteer-media.service.js';
import { sendSuccess } from '../utils/response.js';

export class ZooteerMediaController {
  static async token(request: FastifyRequest, reply: FastifyReply) {
    const { roomId } = zooteerRoomIdParamSchema.parse(request.params);
    const result = await issueMediaToken(request.user.id, roomId);
    return sendSuccess(reply, result, 'Media token issued');
  }

  static async webhook(request: FastifyRequest, reply: FastifyReply) {
    const body = typeof request.body === 'string' ? request.body : '';
    const authorization = request.headers.authorization;
    const result = await receiveMediaWebhook(body, authorization);
    return sendSuccess(reply, result, 'Webhook received');
  }
}
