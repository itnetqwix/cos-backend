import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { ZOOTEER_ROOM_LIMITS } from '../services/zooteer-room-rules.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const ZOOTEER_ROOM_STATUSES = ['OPEN', 'CLOSED'] as const;

const nameSchema = z
  .string()
  .trim()
  .min(ZOOTEER_ROOM_LIMITS.NAME_MIN, 'Room name is required')
  .max(ZOOTEER_ROOM_LIMITS.NAME_MAX, 'Room name is too long');

const descriptionSchema = z
  .string()
  .trim()
  .max(ZOOTEER_ROOM_LIMITS.DESCRIPTION_MAX, 'Description is too long')
  .optional();

const capacitySchema = z
  .number()
  .int()
  .min(ZOOTEER_ROOM_LIMITS.CAPACITY_MIN)
  .max(ZOOTEER_ROOM_LIMITS.CAPACITY_MAX);

const idleTimeoutSchema = z
  .number()
  .int()
  .min(ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MIN_SECONDS)
  .max(ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MAX_SECONDS);

/**
 * Create accepts name and optional bounds only.
 * Host, creator, and status come from the server.
 */
export const createZooteerRoomSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    maxParticipants: capacitySchema
      .optional()
      .default(ZOOTEER_ROOM_LIMITS.CAPACITY_DEFAULT),
    idleTimeoutSeconds: idleTimeoutSchema
      .optional()
      .default(ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_DEFAULT_SECONDS),
  })
  .strict();

export type CreateZooteerRoomInput = z.infer<typeof createZooteerRoomSchema>;

export const updateZooteerRoomSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    maxParticipants: capacitySchema.optional(),
    idleTimeoutSeconds: idleTimeoutSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No room fields to update');

export type UpdateZooteerRoomInput = z.infer<typeof updateZooteerRoomSchema>;

export const closeZooteerRoomSchema = z
  .object({
    reason: z.string().trim().min(1).max(ZOOTEER_ROOM_LIMITS.REASON_MAX).optional(),
  })
  .strict();

export type CloseZooteerRoomInput = z.infer<typeof closeZooteerRoomSchema>;

export const zooteerRoomIdParamSchema = z
  .object({
    roomId: z.string().uuid(),
  })
  .strict();

export const listZooteerRoomsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(ZOOTEER_ROOM_STATUSES).optional(),
  })
  .strict();

export type ListZooteerRoomsQuery = z.infer<typeof listZooteerRoomsQuerySchema>;

const roomDataSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: [...ZOOTEER_ROOM_STATUSES] },
    hostId: { type: 'string', format: 'uuid' },
    createdById: { type: 'string', format: 'uuid' },
    maxParticipants: { type: 'integer' },
    idleTimeoutSeconds: { type: 'integer' },
    activeParticipantCount: { type: 'integer' },
    closedAt: { type: 'string', format: 'date-time', nullable: true },
    closedById: { type: 'string', format: 'uuid', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const admin = 'ADMIN only. Planet Zooteer room management (PZ-M02).';

export const createZooteerRoomSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Create a Planet Zooteer room',
  description: `${admin} Status is OPEN. Capacity defaults to 20 and cannot exceed 20. The caller becomes host, creator, and the single ACTIVE host participant. No invitation is created for the host.`,
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      maxParticipants: { type: 'integer', minimum: 2, maximum: 20 },
      idleTimeoutSeconds: { type: 'integer', minimum: 60, maximum: 86400 },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(roomDataSchema, 'Room created'),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const listZooteerRoomsSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'List Planet Zooteer rooms',
  description: `${admin} Soft-deleted rooms are omitted. FULL is not a status filter.`,
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      status: { type: 'string', enum: [...ZOOTEER_ROOM_STATUSES] },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          items: { type: 'array', items: roomDataSchema },
          pagination: { type: 'object' },
        },
      },
      'Rooms retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const getZooteerRoomSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Get a Planet Zooteer room',
  description: `${admin} A soft-deleted room is not found.`,
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(roomDataSchema, 'Room retrieved successfully'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
  },
};

export const closeZooteerRoomSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Close a Planet Zooteer room',
  description: `${admin} OPEN becomes CLOSED. A second close is 409. Closed rooms are not reopened in PZ-M02.`,
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    properties: { reason: { type: 'string' } },
  },
  response: {
    200: swaggerSuccessEnvelope(roomDataSchema, 'Room closed'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
    409: swaggerErrorEnvelope('Room is already closed'),
  },
};

const participantSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    roomId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['ACTIVE', 'LEFT'] },
    participantRole: { type: 'string', enum: ['HOST', 'PARTICIPANT'] },
    firstJoinedAt: { type: 'string', format: 'date-time' },
    lastJoinedAt: { type: 'string', format: 'date-time' },
    leftAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const listZooteerParticipantsSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'List durable room membership',
  description: `${admin} Returns the single membership row per user, including LEFT. This is not a join endpoint.`,
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: participantSchema },
      'Participants retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
  },
};

export const mediaTokenSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Issue a short-lived LiveKit token',
  description:
    'Authenticated member who has already accepted an invitation. The token identity is the JWT user. Screen share and recording grants are not included. The API secret is not returned.',
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          url: { type: 'string' },
          token: { type: 'string' },
        },
      },
      'Media token issued',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
    409: swaggerErrorEnvelope('Room is closed'),
    503: swaggerErrorEnvelope('LiveKit is not configured'),
  },
};

export const providerCleanupSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Retry LiveKit cleanup for a closed room',
  description:
    'ADMIN only. Does not reopen the room and does not delete membership history. A second close stays 409. An open room only applies the disconnect grace.',
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          roomStatus: { type: 'string' },
          providerCleanup: { type: 'string' },
        },
      },
      'Room reconciliation finished',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
    503: swaggerErrorEnvelope('Provider cleanup failed'),
  },
};

export const livekitWebhookSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'LiveKit webhook',
  description:
    'Signed by LiveKit. Invalid signatures are rejected. This route does not accept a member JWT as authorization.',
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object', properties: { ignored: { type: 'boolean' } } },
      'Webhook received',
    ),
    401: swaggerErrorEnvelope('Invalid LiveKit webhook signature'),
  },
};
