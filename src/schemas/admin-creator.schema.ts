import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { AccountStatus } from '@prisma/client';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const creatorIdParamSchema = z.object({
  id: z.string().uuid('Creator ID must be a valid UUID format'),
});

export const adminSubmissionIdParamSchema = z.object({
  id: z.string().uuid('Submission ID must be a valid UUID format'),
});

export const adminContestIdParamSchema = z.object({
  id: z.string().uuid('Contest ID must be a valid UUID format'),
});

export const listCreatorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  contestId: z.string().uuid().optional(),
});

export const creatorPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const warnCreatorSchema = z.object({
  reason: z.string().trim().min(1, 'Warning reason is required').max(2000),
});

export const creatorStatusSchema = z.object({
  accountStatus: z.nativeEnum(AccountStatus),
});

const paginationSchema = {
  type: 'object',
  properties: {
    totalCount: { type: 'integer' },
    totalPages: { type: 'integer' },
    currentPage: { type: 'integer' },
    limit: { type: 'integer' },
    hasNextPage: { type: 'boolean' },
    hasPrevPage: { type: 'boolean' },
  },
};

const summarySchema = {
  type: 'object',
  properties: {
    totalCreators: { type: 'integer' },
    activeCreators: { type: 'integer' },
    blockedCreators: { type: 'integer' },
    totalVideos: { type: 'integer' },
    approvedVideos: { type: 'integer' },
    pendingVideos: { type: 'integer' },
    rejectedVideos: { type: 'integer' },
    flaggedVideos: { type: 'integer' },
    underModerationVideos: { type: 'integer' },
  },
};

const creatorListItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
    accountStatus: { type: 'string' },
    createdAt: { type: 'string' },
    lastActivityAt: { type: 'string', nullable: true },
    totalVideos: { type: 'integer' },
    approvedVideos: { type: 'integer' },
    pendingVideos: { type: 'integer' },
    rejectedVideos: { type: 'integer' },
    flaggedVideos: { type: 'integer' },
    contestsParticipated: { type: 'integer' },
    submissionCount: { type: 'integer' },
  },
};

const adminQuerystring = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

export const listCreatorsSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'List registered creators',
  description:
    'ADMIN only. Paginated creator directory with video counts, contest participation, and account status. Passwords are not included. pendingVideos is PENDING_REVIEW. underModerationVideos is PENDING_REVIEW plus FLAGGED.',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      search: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] },
      contestId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          totalCreators: { type: 'integer' },
          summary: summarySchema,
          creators: { type: 'array', items: creatorListItemSchema },
          pagination: paginationSchema,
        },
      },
      'Creators retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const getCreatorSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Get a creator and their submissions',
  description:
    'ADMIN only. Includes account status, stats, warnings, submission status, contest, and a presigned playback URL. Does not expose storage credentials.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object' }, 'Creator retrieved successfully'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
  },
};

export const creatorSubresourceSwaggerSchema = (
  summary: string,
  message: string,
): FastifySchema => ({
  tags: ['Admin'],
  summary,
  description: 'ADMIN only.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  querystring: adminQuerystring,
  response: {
    200: swaggerSuccessEnvelope({ type: 'object' }, message),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
  },
});

export const warnCreatorSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Warn a creator',
  description:
    'ADMIN only. Stores an administrative warning. Does not block the creator and does not send a notification. Automatic warning thresholds are NOT SPECIFIED.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
  response: {
    201: swaggerSuccessEnvelope({ type: 'object' }, 'Warning issued successfully'),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
  },
};

export const creatorStatusSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Block or unblock a creator',
  description:
    'ADMIN only. Sets account status to ACTIVE or BLOCKED. Does not delete content. Cannot target an ADMIN account.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['accountStatus'],
    properties: {
      accountStatus: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object' },
      'Creator status updated successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
  },
};

export const contestParticipantsSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'List creators participating in a contest',
  description:
    'ADMIN only. Participation is a creator with at least one submission in the contest. There is no separate membership record.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  querystring: adminQuerystring,
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object' },
      'Contest participants retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Contest not found'),
  },
};

export const deleteCreatorSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Delete a creator submission',
  description:
    'ADMIN only. Deletes the submission row. Ratings and comments cascade. The creator account, contest, and other submissions are kept. The S3 object is not deleted.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          deleted: { type: 'boolean' },
          mediaObjectRetained: { type: 'boolean' },
        },
      },
      'Submission deleted successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Submission not found'),
  },
};
