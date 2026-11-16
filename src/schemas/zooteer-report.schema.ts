import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const REPORT_CATEGORIES = [
  'HARASSMENT',
  'HATE',
  'SEXUAL',
  'VIOLENCE',
  'SPAM',
  'OTHER',
] as const;
export const REPORT_STATUSES = ['OPEN', 'REVIEWED', 'RESOLVED'] as const;

export const createZooteerReportSchema = z
  .object({
    reportedUserId: z.string().uuid(),
    category: z.enum(REPORT_CATEGORIES),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateZooteerReportInput = z.infer<typeof createZooteerReportSchema>;

export const listZooteerReportsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(REPORT_STATUSES).optional(),
  })
  .strict();

export const zooteerReportIdParamSchema = z
  .object({ reportId: z.string().uuid() })
  .strict();

const reportView = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    roomId: { type: 'string', format: 'uuid' },
    reporterId: { type: 'string', format: 'uuid' },
    reportedUserId: { type: 'string', format: 'uuid' },
    category: { type: 'string', enum: [...REPORT_CATEGORIES] },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: [...REPORT_STATUSES] },
    createdAt: { type: 'string', format: 'date-time' },
    reviewedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

export const realtimeContractSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Realtime chat contract',
  description:
    'Admitted participant. Describes LiveKit data-channel events. This route does not accept or return chat messages.',
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object' }, 'Realtime contract'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('Room is closed'),
  },
};

export const relayZooteerEventSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Relay a chat or emoji event',
  description:
    'Admitted participant of an OPEN room. The server validates the event and publishes it to LiveKit. The message is not stored. Sender is the JWT user. Direct participant publish is not granted.',
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  body: { type: 'object' },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: { id: { type: 'string' }, type: { type: 'string' } },
      },
      'Event accepted',
    ),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('Room is closed'),
    429: swaggerErrorEnvelope('Too many requests'),
    503: swaggerErrorEnvelope('LiveKit is unavailable'),
  },
};

export const createZooteerReportSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Report a participant',
  description:
    'Admitted participant. Stores the report only. Chat messages are not attached. Rate limit is process-local.',
  params: {
    type: 'object',
    required: ['roomId'],
    properties: { roomId: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['reportedUserId', 'category'],
    properties: {
      reportedUserId: { type: 'string', format: 'uuid' },
      category: { type: 'string', enum: [...REPORT_CATEGORIES] },
      description: { type: 'string' },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(reportView, 'Report submitted'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('Room is closed'),
    429: swaggerErrorEnvelope('Too many requests'),
  },
};

const reportPageSchema = {
  type: 'object',
  required: ['items', 'pagination'],
  properties: {
    items: { type: 'array', items: reportView },
    pagination: {
      type: 'object',
      required: [
        'totalCount',
        'totalPages',
        'currentPage',
        'limit',
        'hasNextPage',
        'hasPrevPage',
      ],
      properties: {
        totalCount: { type: 'integer' },
        totalPages: { type: 'integer' },
        currentPage: { type: 'integer' },
        limit: { type: 'integer' },
        hasNextPage: { type: 'boolean' },
        hasPrevPage: { type: 'boolean' },
      },
    },
  },
};

export const listZooteerReportsSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'List abuse reports',
  description:
    'ADMIN only. data is { items, pagination } inside the standard success envelope. Does not include chat history.',
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      limit: { type: 'integer' },
      status: { type: 'string', enum: [...REPORT_STATUSES] },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(reportPageSchema, 'Reports retrieved'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const reviewZooteerReportSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Mark an abuse report reviewed',
  description: 'ADMIN only. OPEN becomes REVIEWED.',
  params: {
    type: 'object',
    required: ['reportId'],
    properties: { reportId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reportView, 'Report reviewed'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('Report cannot be reviewed'),
  },
};

export const resolveZooteerReportSwaggerSchema: FastifySchema = {
  tags: ['Planet Zooteer'],
  summary: 'Resolve an abuse report',
  description: 'ADMIN only. OPEN or REVIEWED becomes RESOLVED.',
  params: {
    type: 'object',
    required: ['reportId'],
    properties: { reportId: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reportView, 'Report resolved'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('Report cannot be resolved'),
  },
};
