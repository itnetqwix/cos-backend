import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * Leaderboard HTTP contracts (M09-P01).
 *
 * GET /contests/:id/leaderboard is public. It returns APPROVED submissions
 * ranked strictly in descending order of calculated communityScore (with
 * totalVotes breaking ties).
 *
 * Category filter: optional query param to filter submissions.
 * Timeframe filter: optional query param. Historical time-window ranking
 *   and timeframe trend calculations are NOT SPECIFIED in source documentation
 *   (M09-P01-T03). The parameter is accepted and documented.
 *
 * Exclusions: REJECTED, PENDING_REVIEW, and FLAGGED submissions are purged (BR-WIN-02).
 * Closed contests (COMPLETED, ARCHIVED) are read-only historical records (BR-WIN-03).
 */

export const getLeaderboardParamsSchema = z.object({
  id: z.string().uuid('Contest id must be a valid UUID'),
});

export const getLeaderboardQuerySchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  timeframe: z.string().trim().min(1).max(50).optional(),
});

export type GetLeaderboardParams = z.infer<typeof getLeaderboardParamsSchema>;
export type GetLeaderboardQuery = z.infer<typeof getLeaderboardQuerySchema>;

const leaderboardItemSchema = {
  type: 'object',
  properties: {
    rank: { type: 'integer', example: 1 },
    id: { type: 'string', example: 'd3b07384-d113-4a6c-9c09-7708579d4692' },
    contestId: { type: 'string', example: 'c1b07384-d113-4a6c-9c09-7708579d4691' },
    contestTitle: { type: 'string', example: 'Ripskis Comedy Challenge' },
    title: { type: 'string', example: 'Epic VFX Comedy Skit' },
    description: {
      type: 'string',
      nullable: true,
      example: 'A funny skit with VFX effects',
    },
    videoUrl: { type: 'string', example: 'https://example.com/video.mp4' },
    thumbnailUrl: {
      type: 'string',
      nullable: true,
      example: 'https://example.com/thumb.jpg',
    },
    durationSeconds: { type: 'integer', example: 15 },
    tags: { type: 'array', items: { type: 'string' } },
    communityScore: { type: 'number', example: 4.8 },
    totalVotes: { type: 'integer', example: 125 },
    createdAt: { type: 'string', example: '2026-09-22T12:00:00.000Z' },
    creator: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'u2b07384-d113-4a6c-9c09-7708579d4693' },
        name: { type: 'string', example: 'Kai Tanaka' },
      },
    },
  },
};

const contestSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'c1b07384-d113-4a6c-9c09-7708579d4691' },
    title: { type: 'string', example: 'Ripskis Comedy Challenge' },
    status: { type: 'string', example: 'ACTIVE' },
    category: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
      },
    },
  },
};

const leaderboardDataSchema = {
  type: 'object',
  properties: {
    contest: contestSummarySchema,
    totalEntries: { type: 'integer', example: 42 },
    totalVotes: { type: 'integer', example: 14820 },
    averageScore: { type: 'number', example: 4.2 },
    items: { type: 'array', items: leaderboardItemSchema },
    podium: { type: 'array', items: leaderboardItemSchema },
  },
};

export const getLeaderboardSwaggerSchema: FastifySchema = {
  tags: ['Leaderboard'],
  summary: 'Ranked leaderboard for a contest',
  description:
    'Public. Returns APPROVED submissions ranked strictly in descending order of communityScore (totalVotes breaking ties). ' +
    'Rejected, pending, and flagged submissions are purged. Closed contests return read-only historical rankings. ' +
    'Category filtering is supported. Timeframe filtering is accepted but timeframe calculations are NOT SPECIFIED in MVP.',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Contest UUID' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Category name or slug filter' },
      timeframe: {
        type: 'string',
        description: 'Timeframe filter (NOT SPECIFIED for dynamic recalculation in MVP)',
      },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      leaderboardDataSchema,
      'Leaderboard retrieved successfully',
    ),
    400: swaggerErrorEnvelope('Validation error'),
    404: swaggerErrorEnvelope('Contest not found'),
  },
};
