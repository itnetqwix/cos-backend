import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  chatFriendshipParamSchema,
  chatHistoryQuerySchema,
  presignChatAttachmentSchema,
  sendChatMessageSchema,
} from '../schemas/chat.schema.js';
import { ChatConversationView, ChatService } from '../services/chat.service.js';
import { subscribeChat } from '../services/chat-realtime.js';
import { signedAvatarUrl } from '../services/storage.service.js';
import { UnauthorizedError, sendSuccess } from '../utils/response.js';

function actorId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (!id) {
    throw new UnauthorizedError('Unauthorized: Authentication required');
  }
  return id;
}

async function toPeer(peer: ChatConversationView['peer']) {
  const avatarUrl = await signedAvatarUrl(peer.avatarObjectKey);
  return {
    id: peer.id,
    name: peer.name,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export class ChatController {
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const rows = await ChatService.listConversations(actorId(request));
    return sendSuccess(
      reply,
      await Promise.all(
        rows.map(async (row) => ({
          friendshipId: row.friendshipId,
          peer: await toPeer(row.peer),
          unreadCount: row.unreadCount,
          lastMessage: row.lastMessage,
        })),
      ),
      'Conversations retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async messages(request: FastifyRequest, reply: FastifyReply) {
    const { id } = chatFriendshipParamSchema.parse(request.params);
    const query = chatHistoryQuerySchema.parse(request.query ?? {});
    const before = query.before ? new Date(query.before) : null;
    const page = await ChatService.listMessages(
      actorId(request),
      id,
      before,
      query.limit ?? 40,
    );
    return sendSuccess(reply, page, 'Messages retrieved successfully', HTTP_STATUS.OK);
  }

  static async send(request: FastifyRequest, reply: FastifyReply) {
    const { id } = chatFriendshipParamSchema.parse(request.params);
    const body = sendChatMessageSchema.parse(request.body ?? {});
    const message = await ChatService.sendMessage(actorId(request), id, body);
    return sendSuccess(reply, message, 'Message sent', HTTP_STATUS.CREATED);
  }

  static async read(request: FastifyRequest, reply: FastifyReply) {
    const { id } = chatFriendshipParamSchema.parse(request.params);
    const result = await ChatService.markRead(actorId(request), id);
    return sendSuccess(reply, result, 'Conversation marked read', HTTP_STATUS.OK);
  }

  static async presign(request: FastifyRequest, reply: FastifyReply) {
    const body = presignChatAttachmentSchema.parse(request.body ?? {});
    const signed = await ChatService.presignAttachment(actorId(request), body);
    return sendSuccess(reply, signed, 'Upload URL created', HTTP_STATUS.OK);
  }

  static async stream(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;
    const userId = actorId(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    let closed = false;
    const unsubscribe = subscribeChat(userId, (event) => {
      if (closed) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const timer = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 25000);
    timer.unref();

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
    };
    request.raw.on('close', close);
    reply.raw.on('close', close);
  }
}
