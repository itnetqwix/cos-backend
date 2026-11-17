import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const INVITATION_EXPIRY_DEFAULT_HOURS = 24;
export const INVITATION_EXPIRY_MIN_HOURS = 1;
export const INVITATION_EXPIRY_MAX_HOURS = 168;

export const createZooteerInvitationSchema = z
  .object({
    userId: z.string().uuid(),
    expiresInHours: z
      .number()
      .int()
      .min(INVITATION_EXPIRY_MIN_HOURS)
      .max(INVITATION_EXPIRY_MAX_HOURS)
      .optional()
      .default(INVITATION_EXPIRY_DEFAULT_HOURS),
  })
  .strict();

export type CreateZooteerInvitationInput = z.infer<typeof createZooteerInvitationSchema>;

export const listZooteerInvitationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListZooteerInvitationsQuery = z.infer<
  typeof listZooteerInvitationsQuerySchema
>;

export const zooteerInvitationParamsSchema = z
  .object({
    roomId: z.string().uuid(),
    invitationId: z.string().uuid(),
  })
  .strict();

export const acceptZooteerInvitationSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
  })
  .strict();

export type AcceptZooteerInvitationInput = z.infer<typeof acceptZooteerInvitationSchema>;

const invitationView = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    roomId: { type: 'string', format: 'uuid' },
    inviteeUserId: { type: 'string', format: 'uuid' },
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: { type: 'string', format: 'date-time', nullable: true },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
    createdById: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    state: { type: 'string', enum: ['active', 'expired', 'revoked', 'accepted'] },
  },
};

const admin = 'ADMIN only. Planet Zooteer invitations (PZ-M03).';

export const createZooteerInvitationSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Invite a verified user to a room',
  description: `${admin} Default expiry is 24 hours. The raw token is returned once in the link and is not stored.`,
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      expiresInHours: { type: 'integer', minimum: 1, maximum: 168 },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          invitation: invitationView,
          link: { type: 'string' },
          email: {
            type: 'object',
            properties: {
              delivered: { type: 'boolean' },
              error: { type: 'string', nullable: true },
            },
          },
        },
      },
      'Invitation created',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Room not found'),
    409: swaggerErrorEnvelope('A usable invitation already exists'),
    503: swaggerErrorEnvelope('FRONTEND_URL is not configured'),
  },
};

export const listZooteerInvitationsSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'List room invitations',
  description: `${admin} Token hashes are not returned.`,
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      limit: { type: 'integer' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          items: { type: 'array', items: invitationView },
          pagination: { type: 'object' },
        },
      },
      'Invitations retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const revokeZooteerInvitationSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Revoke an invitation',
  description: `${admin} Accepted and already revoked invitations return 409. The row is kept.`,
  params: {
    type: 'object',
    required: ['roomId', 'invitationId'],
    properties: {
      roomId: { type: 'string', format: 'uuid' },
      invitationId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(invitationView, 'Invitation revoked'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Invitation not found'),
    409: swaggerErrorEnvelope('Invitation cannot be revoked'),
  },
};

export const zooteerAccessSchema = z
  .object({
    code: z.string().trim().min(4).max(200),
  })
  .strict();

export type ZooteerAccessInput = z.infer<typeof zooteerAccessSchema>;

const accessView = {
  type: 'object',
  properties: {
    state: {
      type: 'string',
      enum: [
        'valid',
        'pending',
        'accepted',
        'expired',
        'revoked',
        'invalid',
        'full',
        'closed',
        'not_invited',
      ],
    },
    roomId: { type: 'string', format: 'uuid', nullable: true },
    participantId: { type: 'string', format: 'uuid', nullable: true },
    roomName: { type: 'string', nullable: true },
    code: { type: 'string', nullable: true },
  },
};

export const enterZooteerAccessSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Enter with a room code or invitation token',
  description:
    'Authenticated. A room code admits only the signed-in account that was invited or already has a membership. Another account’s token is invalid. The room id does not change.',
  body: {
    type: 'object',
    required: ['code'],
    properties: { code: { type: 'string' } },
  },
  response: {
    200: swaggerSuccessEnvelope(accessView, 'Access checked'),
    401: swaggerErrorEnvelope('Unauthorized'),
  },
};

export const zooteerInboxSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'List the signed-in user invitations',
  description:
    'Authenticated. Only invitations bound to the JWT user. Not a public room directory.',
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            roomId: { type: 'string', format: 'uuid' },
            roomName: { type: 'string' },
            code: { type: 'string' },
            roomStatus: { type: 'string' },
            state: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      'Invitations retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
  },
};

export const acceptZooteerInvitationSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Accept an invitation',
  description:
    'Authenticated invitee only. The user id is taken from the JWT. A token for another account is not distinguished from an unknown token.',
  body: {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          roomId: { type: 'string', format: 'uuid' },
          participantId: { type: 'string', format: 'uuid' },
        },
      },
      'Invitation accepted',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Invitation not found'),
    409: swaggerErrorEnvelope('Room is full'),
  },
};
