import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * Judging HTTP contracts (M08-P03).
 *
 * GET /contests/:id/queue is public. It returns APPROVED submissions only
 * while the contest is ACTIVE or JUDGING.
 *
 * POST /contests/:id/videos/:videoId/rate does not require authentication.
 * Visitors may rate without creator registration (project overview).
 * No account is required. A missing Authorization header is an anonymous guest.
 * Authenticated ADMIN and CREATOR are 403. An invalid token is 401.
 *
 * voterFingerprint is optional. The fingerprint algorithm is NOT SPECIFIED.
 * The field is stored as sent and is not required. There is no uniqueness
 * rule, so a second rating from the same viewer is a new vote.
 *
 * Rate success data is previousScore, newScore, delta, totalVotes.
 */

export const contestIdParamSchema = z.object({
  id: z.string().uuid('Contest id must be a valid UUID'),
});

export const rateParamsSchema = z.object({
  id: z.string().uuid('Contest id must be a valid UUID'),
  videoId: z.string().uuid('Video id must be a valid UUID'),
});

export const rateBodySchema = z
  .object({
    rating: z
      .number({ error: 'Rating must be an integer from 1 to 5' })
      .int('Rating must be an integer from 1 to 5')
      .min(1, 'Rating must be an integer from 1 to 5')
      .max(5, 'Rating must be an integer from 1 to 5'),
    voterFingerprint: z
      .string()
      .trim()
      .min(1, 'voterFingerprint cannot be empty')
      .max(256, 'voterFingerprint cannot exceed 256 characters')
      .optional(),
  })
  .strict();

export type RateBodyInput = z.infer<typeof rateBodySchema>;

const queueItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    videoUrl: { type: 'string' },
    thumbnailUrl: { type: 'string', nullable: true },
    durationSeconds: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    communityScore: { type: 'number' },
    totalVotes: { type: 'integer' },
    status: { type: 'string', example: 'APPROVED' },
    category: { type: 'string', nullable: true },
    creator: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    createdAt: { type: 'string' },
  },
};

const queueDataSchema = {
  type: 'object',
  properties: {
    contestId: { type: 'string' },
    status: { type: 'string', example: 'ACTIVE' },
    autoAdvanceDelayMs: { type: 'integer', example: 1800 },
    items: { type: 'array', items: queueItemSchema },
  },
};

const rateDataSchema = {
  type: 'object',
  properties: {
    previousScore: { type: 'number', example: 0 },
    newScore: { type: 'number', example: 5 },
    delta: { type: 'number', example: 5 },
    totalVotes: { type: 'integer', example: 1 },
  },
};

export const judgingQueueSwaggerSchema: FastifySchema = {
  tags: ['Judging'],
  summary: 'Approved judging queue for a contest',
  description:
    'Public. Returns APPROVED submissions only, oldest first (display order, not a leaderboard). ' +
    'Contest must be ACTIVE or JUDGING. Rejected, pending, and flagged submissions are excluded. ' +
    'autoAdvanceDelayMs is the contest value (default 1800). Authentication is not required.',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      description: 'Judging queue',
      ...swaggerSuccessEnvelope(queueDataSchema, 'Judging queue retrieved successfully'),
    },
    404: {
      description: 'Contest not found',
      ...swaggerErrorEnvelope('Contest not found'),
    },
    409: {
      description: 'Contest is not in the voting window',
      ...swaggerErrorEnvelope(
        'Votes are only accepted while a contest is ACTIVE or JUDGING',
      ),
    },
  },
};

export const rateSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Judging'],
  summary: 'Rate an approved submission',
  description:
    'Auth is optional. Anonymous visitors may rate (no creator registration). ' +
    'Guests rate without a token. An authenticated ADMIN or CREATOR is 403. ' +
    'An invalid Bearer token is 401. voterFingerprint is optional and is not hashed; ' +
    'the fingerprint algorithm and duplicate-vote window are NOT SPECIFIED, so this route ' +
    'does not reject a second rating. Contest must be ACTIVE or JUDGING. Submission must be APPROVED. ' +
    'Returns previousScore, newScore, delta, and totalVotes. newScore is rounded to 1 decimal. ' +
    'M12-P01-T02 applies a per-IP engineering rate limit (RATE_LIMIT_DEFAULTS.RATING_MAX per RATING_TIME_WINDOW_MS). ' +
    'The numeric ceiling is an engineering default. Duplicate-vote detection remains NOT SPECIFIED.',
  params: {
    type: 'object',
    required: ['id', 'videoId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      videoId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['rating'],
    additionalProperties: false,
    properties: {
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      voterFingerprint: { type: 'string', minLength: 1, maxLength: 256 },
    },
  },
  response: {
    200: {
      description: 'Updated community score',
      ...swaggerSuccessEnvelope(rateDataSchema, 'Rating recorded'),
    },
    400: {
      description: 'Rating is not an integer from 1 to 5',
      ...swaggerErrorEnvelope('Validation error', [
        { field: 'rating', message: 'Rating must be an integer from 1 to 5' },
      ]),
    },
    401: {
      description: 'Bearer token was present and invalid',
      ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
    },
    403: {
      description: 'Authenticated role is not a viewer',
      ...swaggerErrorEnvelope(
        "Forbidden: User role 'CREATOR' does not have permission to access this resource",
      ),
    },
    404: {
      description: 'Submission is not in this contest',
      ...swaggerErrorEnvelope('Submission not found'),
    },
    409: {
      description:
        'Contest is outside the voting window or the submission is not approved',
      ...swaggerErrorEnvelope('Only approved submissions can be rated'),
    },
    429: {
      description:
        'Too many requests. Per-IP engineering default for rating POST (M12-P01-T02). Not a business-rule threshold.',
      ...swaggerErrorEnvelope('Too many requests'),
    },
  },
};
