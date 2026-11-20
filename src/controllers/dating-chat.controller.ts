import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { datingActorId, pageOf } from './dating-profile.controller.js';
import {
  datingChatPresignSchema,
  datingIdParamSchema,
  datingMessageSchema,
  datingPageQuerySchema,
} from '../schemas/dating.schema.js';
import { DatingChatService } from '../services/dating-chat.service.js';
import { subscribeDating } from '../services/dating-realtime.js';
import { sendSuccess } from '../utils/response.js';

export class DatingChatController {
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingChatService.list(datingActorId(request));
    return sendSuccess(reply, data, 'Conversations retrieved', HTTP_STATUS.OK);
  }

  static async messages(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const query = datingPageQuerySchema.parse(request.query ?? {});
    const { page, limit } = pageOf(query);
    const data = await DatingChatService.messages(
      datingActorId(request),
      id,
      page,
      limit,
    );
    return sendSuccess(reply, data, 'Messages retrieved', HTTP_STATUS.OK);
  }

  static async send(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const body = datingMessageSchema.parse(request.body ?? {});
    const data = await DatingChatService.send(datingActorId(request), id, body);
    return sendSuccess(reply, data, 'Message sent', HTTP_STATUS.CREATED);
  }

  static async read(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingChatService.markRead(datingActorId(request), id);
    return sendSuccess(reply, data, 'Conversation marked read', HTTP_STATUS.OK);
  }

  static async presign(request: FastifyRequest, reply: FastifyReply) {
    const body = datingChatPresignSchema.parse(request.body ?? {});
    const data = await DatingChatService.presignAttachment(
      datingActorId(request),
      body.conversationId,
      body.contentType,
      body.fileSizeBytes,
    );
    return sendSuccess(reply, data, 'Upload URL created', HTTP_STATUS.OK);
  }

  static async stream(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;
    const userId = datingActorId(request);
    reply.hijack();
    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
    const write = (chunk: string) => {
      if (closed || reply.raw.writableEnded || reply.raw.destroyed) {
        close();
        return;
      }
      try {
        reply.raw.write(chunk);
      } catch {
        close();
      }
    };
    reply.raw.on('error', close);
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
    }
    write('retry: 3000\n\n');
    unsubscribe = subscribeDating(userId, (event) => {
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    timer = setInterval(() => {
      write(': ping\n\n');
    }, 25000);
    timer.unref();
    request.raw.on('close', close);
    reply.raw.on('close', close);
  }
}
