import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * One Toke request contracts (M03-P01-T01).
 * Clients cannot submit an overall score or a weight snapshot.
 * Active-category completeness is checked by the lifecycle service at submit.
 */

const NOTES_MAX = 5000;
const FEEDBACK_MAX = 2000;
const PLACE_MAX = 80;
const DISPENSARY_MAX = 120;

export const REVIEW_TEXT_LIMITS = {
  notes: NOTES_MAX,
  feedback: FEEDBACK_MAX,
  place: PLACE_MAX,
  dispensary: DISPENSARY_MAX,
} as const;

const uuid = (label: string) => z.string().uuid(`${label} must be a valid UUID`);

export const categoryScoreSchema = z
  .object({
    categoryId: uuid('categoryId'),
    score: z.number().int().min(1).max(10),
  })
  .strict();

export type CategoryScoreInput = z.infer<typeof categoryScoreSchema>;

const videoContentTypeSchema = z.enum(VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES);

export const presignReviewSchema = z
  .object({
    contentType: videoContentTypeSchema,
    fileSizeBytes: z.number().int().positive().max(VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES),
    durationSeconds: z
      .number()
      .int()
      .min(VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS)
      .max(VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS),
  })
  .strict();

export type PresignReviewInput = z.infer<typeof presignReviewSchema>;

const locationFields = {
  dispensaryName: z.string().trim().min(1).max(DISPENSARY_MAX).nullable().optional(),
  city: z.string().trim().min(1).max(PLACE_MAX).nullable().optional(),
  state: z.string().trim().min(1).max(PLACE_MAX).nullable().optional(),
  country: z.string().trim().min(1).max(PLACE_MAX).nullable().optional(),
};

export const createReviewDraftSchema = z
  .object({
    productId: uuid('productId'),
    productTypeId: uuid('productTypeId').optional(),
    videoObjectKey: z.string().trim().min(1).max(512),
    thumbnailUrl: z.string().trim().min(1).max(512).nullable().optional(),
    durationSeconds: z
      .number()
      .int()
      .min(VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS)
      .max(VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS),
    reviewNotes: z.string().trim().max(NOTES_MAX).nullable().optional(),
    categoryScores: z.array(categoryScoreSchema).max(20).optional(),
    ...locationFields,
  })
  .strict();

export type CreateReviewDraftInput = z.infer<typeof createReviewDraftSchema>;

export const updateReviewDraftSchema = createReviewDraftSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateReviewDraftInput = z.infer<typeof updateReviewDraftSchema>;

export const submitReviewSchema = z
  .object({
    categoryScores: z.array(categoryScoreSchema).min(1).max(20).optional(),
  })
  .strict();

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

export const requestReviewChangesSchema = z
  .object({
    notes: z
      .string()
      .trim()
      .min(1, 'Changes-requested notes are required')
      .max(FEEDBACK_MAX),
  })
  .strict();

export type RequestReviewChangesInput = z.infer<typeof requestReviewChangesSchema>;

export const approveReviewSchema = z.object({}).strict();
export const publishReviewSchema = z.object({}).strict();

export const reviewIdParamSchema = z.object({
  id: uuid('id'),
});

export type ReviewIdParam = z.infer<typeof reviewIdParamSchema>;

export const reviewListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['score', 'publishedAt']).optional(),
    productId: uuid('productId').optional(),
    productTypeId: uuid('productTypeId').optional(),
    categoryId: uuid('categoryId').optional(),
    testerId: uuid('testerId').optional(),
    city: z.string().trim().min(1).max(PLACE_MAX).optional(),
    state: z.string().trim().min(1).max(PLACE_MAX).optional(),
    country: z.string().trim().min(1).max(PLACE_MAX).optional(),
    dispensaryName: z.string().trim().min(1).max(DISPENSARY_MAX).optional(),
    minOverallScore: z.coerce.number().min(0).max(10).optional(),
    maxOverallScore: z.coerce.number().min(0).max(10).optional(),
    publishedFrom: z.coerce.date().optional(),
    publishedTo: z.coerce.date().optional(),
  })
  .strict();

export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const reviewQueueQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    productId: uuid('productId').optional(),
    testerId: uuid('testerId').optional(),
  })
  .strict();

export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

const error400 = swaggerErrorEnvelope('Validation error', [
  { field: 'score', message: 'Too big' },
]);
const error401 = swaggerErrorEnvelope('Unauthorized: Authentication required');
const error403 = swaggerErrorEnvelope('Forbidden: Tester capability is not enabled');
const error404 = swaggerErrorEnvelope('Review not found');
const error409 = swaggerErrorEnvelope(
  'Invalid review status transition from DRAFT to PUBLISHED',
);

const presignData = {
  type: 'object',
  properties: {
    uploadUrl: { type: 'string' },
    objectKey: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    expiresInSeconds: { type: 'integer' },
    method: { type: 'string', enum: ['PUT'] },
    thumbnail: {
      type: 'object',
      nullable: true,
      properties: {
        uploadUrl: { type: 'string' },
        objectKey: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        expiresInSeconds: { type: 'integer' },
        method: { type: 'string', enum: ['PUT'] },
      },
    },
  },
};

const reviewData = { type: 'object', additionalProperties: true };
const pageData = {
  type: 'object',
  properties: {
    items: { type: 'array', items: reviewData },
    pagination: { type: 'object', additionalProperties: true },
    ranking: { type: 'string' },
  },
};

const secured = [{ bearerAuth: [] }];

export const presignReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Presign a One Toke review video upload',
  description:
    'Tester capability required. Returns a video PUT and a paired JPEG thumbnail PUT. Fastify does not receive video bytes. Overall score is not accepted.',
  security: secured,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['contentType', 'fileSizeBytes', 'durationSeconds'],
    properties: {
      contentType: { type: 'string', enum: [...VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES] },
      fileSizeBytes: {
        type: 'integer',
        minimum: 1,
        maximum: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES,
      },
      durationSeconds: {
        type: 'integer',
        minimum: VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS,
        maximum: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS,
      },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(presignData),
    400: error400,
    401: error401,
    403: error403,
  },
};

export const createReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Create a review draft',
  description:
    'Tester capability required. testerId is the authenticated user. overallScore and weightsSnapshot are rejected.',
  security: secured,
  response: {
    201: swaggerSuccessEnvelope(reviewData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
  },
};

export const updateReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Update a draft or a published review',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    400: error400,
    401: error401,
    403: error403,
    409: error409,
  },
};

export const submitReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Submit a draft for approval',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    400: error400,
    401: error401,
    403: error403,
    409: error409,
  },
};

export const listMineReviewsSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'List the authenticated tester’s reviews',
  security: secured,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  response: { 200: swaggerSuccessEnvelope(pageData), 401: error401, 403: error403 },
};

export const reviewQueueSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Editorial queue of submitted reviews',
  description: 'Review approver or ADMIN. Does not include drafts.',
  security: secured,
  response: { 200: swaggerSuccessEnvelope(pageData), 401: error401, 403: error403 },
};

export const requestChangesSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Request changes on a submitted review',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['notes'],
    properties: { notes: { type: 'string', minLength: 1, maxLength: FEEDBACK_MAX } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    400: error400,
    401: error401,
    403: error403,
    409: error409,
  },
};

export const approveReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Approve a submitted review without publishing it',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    401: error401,
    403: error403,
    409: error409,
  },
};

export const publishReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Publish an approved review',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    401: error401,
    403: error403,
    409: error409,
  },
};

export const approveAndPublishReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Approve and publish a submitted review in one transaction',
  description: 'Still performs approval and publication as separate transitions.',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(reviewData),
    401: error401,
    403: error403,
    409: error409,
  },
};

export const listPublicReviewsSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Public published reviews',
  description:
    'No auth. status PUBLISHED only. Returns the published revision. Strain is not a query field. Ranking is not applied here.',
  response: { 200: swaggerSuccessEnvelope(pageData), 400: error400 },
};

export const getPublicReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Public published review detail',
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: { 200: swaggerSuccessEnvelope(reviewData), 404: error404 },
};

export const reviewLeaderboardSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Published review leaderboard',
  description:
    'Ranks published reviews by overallScore desc, then publishedAt desc, then id asc. Does not aggregate products and does not use Pledge community scores.',
  response: { 200: swaggerSuccessEnvelope(pageData) },
};
