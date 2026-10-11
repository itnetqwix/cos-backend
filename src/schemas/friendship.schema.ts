import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const friendSearchQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

export const sendFriendRequestSchema = z.object({
  addresseeId: z.string().uuid('Creator id must be a UUID'),
});

export const friendshipIdParamSchema = z.object({
  id: z.string().uuid('Friendship id must be a UUID'),
});

const personSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
};

const friendItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PENDING', 'ACCEPTED'] },
    direction: { type: 'string', enum: ['INCOMING', 'OUTGOING'] },
    createdAt: { type: 'string', format: 'date-time' },
    user: personSchema,
  },
};

const listDataSchema = {
  type: 'object',
  properties: {
    friends: { type: 'array', items: friendItemSchema },
    incoming: { type: 'array', items: friendItemSchema },
    outgoing: { type: 'array', items: friendItemSchema },
  },
};

const searchItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    relationship: { type: 'string', enum: ['NONE', 'INCOMING', 'OUTGOING', 'FRIENDS'] },
    friendshipId: { type: 'string', format: 'uuid', nullable: true },
  },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};

const creatorOnly =
  'CREATOR only. Guests receive 401. ADMIN receives 403. Blocked creators are rejected. This route does not read contests, submissions, ratings, or leaderboards.';

export const listFriendsSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'List accepted friends and pending requests',
  description: creatorOnly,
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(listDataSchema, 'Friends retrieved successfully'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const searchFriendsSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Search creators by name',
  description: `${creatorOnly} Matches name only. Email is not searched or returned. Empty q returns an empty list.`,
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: { q: { type: 'string' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: searchItemSchema },
      'Creators retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const sendFriendRequestSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Send a friend request to another creator',
  description: `${creatorOnly} Self-requests, duplicate pending requests, and requests between existing friends are rejected.`,
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['addresseeId'],
    properties: { addresseeId: { type: 'string', format: 'uuid' } },
  },
  response: {
    201: swaggerSuccessEnvelope(friendItemSchema, 'Friend request sent'),
    400: swaggerErrorEnvelope('You cannot send a friend request to yourself'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
    409: swaggerErrorEnvelope('A friend request already exists'),
  },
};

export const acceptFriendRequestSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Accept an incoming friend request',
  description: `${creatorOnly} Only the recipient of a pending request can accept it.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope(friendItemSchema, 'Friend request accepted'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Friend request not found'),
    409: swaggerErrorEnvelope('This request is no longer pending'),
  },
};

export const rejectFriendRequestSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Reject an incoming friend request',
  description: `${creatorOnly} Only the recipient can reject. The row is deleted.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope({ type: 'null' }, 'Friend request rejected'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Friend request not found'),
    409: swaggerErrorEnvelope('This request is no longer pending'),
  },
};

export const cancelFriendRequestSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Cancel an outgoing friend request',
  description: `${creatorOnly} Only the sender can cancel. The row is deleted.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope({ type: 'null' }, 'Friend request cancelled'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Friend request not found'),
    409: swaggerErrorEnvelope('This request is no longer pending'),
  },
};

export const removeFriendSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Remove an accepted friend',
  description: `${creatorOnly} Either friend can remove an accepted friendship. The row is deleted.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope({ type: 'null' }, 'Friend removed'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Friend request not found'),
    409: swaggerErrorEnvelope('Only accepted friends can be removed'),
  },
};

const friendSubmissionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    durationSeconds: { type: 'integer' },
    communityScore: { type: 'number' },
    totalVotes: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    contestId: { type: 'string', format: 'uuid' },
    contestTitle: { type: 'string' },
    category: { type: 'string', nullable: true },
    videoUrl: { type: 'string' },
    thumbnailUrl: { type: 'string', nullable: true },
  },
};

const friendProfileDataSchema = {
  type: 'object',
  properties: {
    friend: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        avatarUrl: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    stats: {
      type: 'object',
      properties: {
        totalSubmissions: { type: 'integer' },
        totalVotes: { type: 'integer' },
        communityScore: { type: 'number' },
      },
    },
    submissions: {
      type: 'array',
      items: friendSubmissionSchema,
    },
  },
};

export const getFriendProfileSwaggerSchema: FastifySchema = {
  tags: ['Friends'],
  summary: 'Get public profile and approved submissions for an accepted friend',
  description: `${creatorOnly} Only accepted friends can view this profile. Shows only approved, non-deleted submissions. Never exposes email or private creator data.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope(
      friendProfileDataSchema,
      'Friend profile retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Friend profile not found'),
  },
};
