import { FastifySchema } from 'fastify';
import { z } from 'zod';

export const listPledgeVideosQuerySchema = z.object({
  status: z
    .enum(['ALL', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED'])
    .optional()
    .default('ALL'),
  contestId: z.string().uuid().optional(),
  cycleMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  categoryId: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['urgency', 'newest', 'oldest', 'score']).optional().default('urgency'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type ListPledgeVideosQuery = z.infer<typeof listPledgeVideosQuerySchema>;

export const pledgeVideoIdParamSchema = z.object({
  id: z.string().uuid('Invalid video ID format'),
});

export const rejectPledgeVideoSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is required'),
  reasonCode: z.string().trim().optional(),
});

export const approvePledgeVideoSchema = z.object({
  note: z.string().trim().optional(),
});

export const listPledgeAuditLogsQuerySchema = z.object({
  contestId: z.string().uuid().optional(),
});

export const listPledgeVideosSwaggerSchema: FastifySchema = {
  description:
    'List independent Pledge contest videos with filtering, search, and pagination',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['ALL', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED'],
      },
      contestId: { type: 'string' },
      cycleMonth: { type: 'string' },
      categoryId: { type: 'string' },
      search: { type: 'string' },
      sortBy: { type: 'string', enum: ['urgency', 'newest', 'oldest', 'score'] },
      page: { type: 'integer' },
      limit: { type: 'integer' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            items: { type: 'array' },
            metrics: { type: 'object' },
            statusCounts: { type: 'object' },
            pagination: { type: 'object' },
          },
        },
      },
    },
  },
};

export const getPledgeVideoMetricsSwaggerSchema: FastifySchema = {
  description: 'Get metrics summary for Pledge videos',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      contestId: { type: 'string' },
    },
  },
};

export const getPledgeVideoByIdSwaggerSchema: FastifySchema = {
  description: 'Get Pledge video details by ID',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
};

export const approvePledgeVideoSwaggerSchema: FastifySchema = {
  description: 'Approve a Pledge contest video',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    properties: {
      note: { type: 'string' },
    },
  },
};

export const rejectPledgeVideoSwaggerSchema: FastifySchema = {
  description: 'Reject a Pledge contest video with reason',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string' },
      reasonCode: { type: 'string' },
    },
  },
};

export const pledgeVideoPlaybackUrlSwaggerSchema: FastifySchema = {
  description: 'Get signed playback URL for a Pledge video',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
};

export const listPledgeVideoAuditLogsSwaggerSchema: FastifySchema = {
  description: 'List audit decision logs for Pledge videos',
  tags: ['Pledge Videos Admin'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      contestId: { type: 'string' },
    },
  },
};
