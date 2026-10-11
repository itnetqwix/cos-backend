import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  friendSearchQuerySchema,
  friendshipIdParamSchema,
  sendFriendRequestSchema,
} from '../schemas/friendship.schema.js';
import {
  FriendList,
  FriendListItem,
  FriendSearchResult,
  FriendshipService,
} from '../services/friendship.service.js';
import { signedAvatarUrl } from '../services/storage.service.js';
import { UnauthorizedError, sendSuccess } from '../utils/response.js';

async function toPerson(user: {
  id: string;
  name: string;
  avatarObjectKey: string | null;
}) {
  const avatarUrl = await signedAvatarUrl(user.avatarObjectKey);
  return {
    id: user.id,
    name: user.name,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

async function toFriendItem(item: FriendListItem) {
  return {
    id: item.id,
    status: item.status,
    direction: item.direction,
    createdAt: item.createdAt.toISOString(),
    user: await toPerson(item.user),
  };
}

async function toSearchItem(item: FriendSearchResult) {
  const person = await toPerson(item);
  return {
    ...person,
    relationship: item.relationship,
    friendshipId: item.friendshipId,
  };
}

function actorId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (!id) {
    throw new UnauthorizedError('Unauthorized: Authentication required');
  }
  return id;
}

export class FriendshipController {
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const list: FriendList = await FriendshipService.list(actorId(request));
    return sendSuccess(
      reply,
      {
        friends: await Promise.all(list.friends.map(toFriendItem)),
        incoming: await Promise.all(list.incoming.map(toFriendItem)),
        outgoing: await Promise.all(list.outgoing.map(toFriendItem)),
      },
      'Friends retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async search(request: FastifyRequest, reply: FastifyReply) {
    const query = friendSearchQuerySchema.parse(request.query ?? {});
    const results = await FriendshipService.search(actorId(request), query.q);
    return sendSuccess(
      reply,
      await Promise.all(results.map(toSearchItem)),
      'Creators retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async send(request: FastifyRequest, reply: FastifyReply) {
    const body = sendFriendRequestSchema.parse(request.body ?? {});
    const actor = actorId(request);
    const row = await FriendshipService.sendRequest(actor, body.addresseeId);
    const item: FriendListItem = {
      id: row.id,
      status: row.status,
      direction: 'OUTGOING',
      createdAt: row.createdAt,
      user: row.userLowId === actor ? row.userHigh : row.userLow,
    };
    return sendSuccess(
      reply,
      await toFriendItem(item),
      'Friend request sent',
      HTTP_STATUS.CREATED,
    );
  }

  static async accept(request: FastifyRequest, reply: FastifyReply) {
    const { id } = friendshipIdParamSchema.parse(request.params);
    const actor = actorId(request);
    const row = await FriendshipService.accept(actor, id);
    const item: FriendListItem = {
      id: row.id,
      status: row.status,
      direction: 'INCOMING',
      createdAt: row.createdAt,
      user: row.userLowId === actor ? row.userHigh : row.userLow,
    };
    return sendSuccess(
      reply,
      await toFriendItem(item),
      'Friend request accepted',
      HTTP_STATUS.OK,
    );
  }

  static async reject(request: FastifyRequest, reply: FastifyReply) {
    const { id } = friendshipIdParamSchema.parse(request.params);
    await FriendshipService.reject(actorId(request), id);
    return sendSuccess(reply, null, 'Friend request rejected', HTTP_STATUS.OK);
  }

  static async cancel(request: FastifyRequest, reply: FastifyReply) {
    const { id } = friendshipIdParamSchema.parse(request.params);
    await FriendshipService.cancel(actorId(request), id);
    return sendSuccess(reply, null, 'Friend request cancelled', HTTP_STATUS.OK);
  }

  static async remove(request: FastifyRequest, reply: FastifyReply) {
    const { id } = friendshipIdParamSchema.parse(request.params);
    await FriendshipService.remove(actorId(request), id);
    return sendSuccess(reply, null, 'Friend removed', HTTP_STATUS.OK);
  }

  static async getProfile(request: FastifyRequest, reply: FastifyReply) {
    const { id } = friendshipIdParamSchema.parse(request.params);
    const profile = await FriendshipService.getFriendProfile(actorId(request), id);
    return sendSuccess(
      reply,
      profile,
      'Friend profile retrieved successfully',
      HTTP_STATUS.OK,
    );
  }
}
