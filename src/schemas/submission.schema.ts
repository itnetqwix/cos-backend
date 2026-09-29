import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const SUBMISSION_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'FLAGGED',
] as const;

export const allowedVideoContentTypeSchema = z.enum(
  VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES,
);

export const presignSubmissionSchema = z
  .object({
    contestId: z.string().uuid('contestId must be a valid UUID'),
    contentType: allowedVideoContentTypeSchema,
    fileSizeBytes: z
      .number()
      .int()
      .positive()
      .max(
        VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES,
        `fileSizeBytes cannot exceed ${VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES}`,
      ),
    durationSeconds: z
      .number()
      .int()
      .min(VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS)
      .max(VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS),
  })
  .strict();

export type PresignSubmissionInput = z.infer<typeof presignSubmissionSchema>;

export const completeSubmissionSchema = z
  .object({
    contestId: z.string().uuid('contestId must be a valid UUID'),
    objectKey: z.string().min(1, 'objectKey is required'),
    title: z.string().trim().min(1, 'Title is required').max(100),
    description: z.string().trim().max(500).nullable().optional(),
    durationSeconds: z
      .number()
      .int()
      .min(VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS)
      .max(VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    thumbnailUrl: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type CompleteSubmissionInput = z.infer<typeof completeSubmissionSchema>;

export const submissionIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type SubmissionIdParam = z.infer<typeof submissionIdParamSchema>;

const contestSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    status: { type: 'string' },
    organizationId: { type: 'string', format: 'uuid' },
    category: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        slug: { type: 'string' },
      },
    },
  },
};

const submissionViewSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    contestId: { type: 'string', format: 'uuid' },
    creatorId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    videoUrl: { type: 'string' },
    objectKey: { type: 'string' },
    thumbnailUrl: { type: 'string', nullable: true },
    durationSeconds: { type: 'integer' },
    status: { type: 'string', enum: [...SUBMISSION_STATUSES] },
    tags: { type: 'array', items: { type: 'string' } },
    communityScore: { type: 'number' },
    totalVotes: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    contest: contestSummarySchema,
  },
};

const presignViewSchema = {
  type: 'object',
  properties: {
    uploadUrl: { type: 'string' },
    objectKey: { type: 'string' },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    expiresInSeconds: { type: 'integer' },
    method: { type: 'string', enum: ['PUT'] },
  },
};

const creatorOnlyDescription =
  'Auth: CREATOR only. BRAND_ADMIN, VIEWER, and SUPER_ADMIN are forbidden. Unauthenticated requests are 401.';

export const presignSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Submissions'],
  summary: 'Create a presigned S3 upload URL',
  description: `${creatorOnlyDescription} Contest must be ACTIVE and belong to the creator organization. A foreign contest is 403 and is not presigned. Allowed types: video/mp4, video/webm. Max 100MB and 60 seconds (client-reported duration). Fastify never receives video bytes. The legacy binary ingest path is not implemented.`,
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['contestId', 'contentType', 'fileSizeBytes', 'durationSeconds'],
    additionalProperties: false,
    properties: {
      contestId: { type: 'string', format: 'uuid' },
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
    200: {
      description: 'Presigned upload issued',
      ...swaggerSuccessEnvelope(presignViewSchema, 'Presigned upload URL created'),
    },
    400: {
      description: 'Invalid payload, file constraints, or contest not ACTIVE',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Contest not found',
      ...swaggerErrorEnvelope('Contest not found'),
    },
  },
};

export const completeSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Submissions'],
  summary: 'Finalize a submission after the S3 PUT',
  description: `${creatorOnlyDescription} Persists PENDING_REVIEW only when the contest belongs to the creator organization. A foreign contest is 403 and creates no row. objectKey must be the backend-issued key from presign. Status, videoUrl, and storage path are not client-chosen. Retrying the same objectKey is idempotent for the owning creator.`,
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['contestId', 'objectKey', 'title', 'durationSeconds'],
    additionalProperties: false,
    properties: {
      contestId: { type: 'string', format: 'uuid' },
      objectKey: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      durationSeconds: {
        type: 'integer',
        minimum: VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS,
        maximum: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS,
      },
      tags: { type: 'array', items: { type: 'string' } },
      thumbnailUrl: { type: 'string', nullable: true },
    },
  },
  response: {
    201: {
      description: 'Submission created',
      ...swaggerSuccessEnvelope(submissionViewSchema, 'Submission created successfully'),
    },
    200: {
      description: 'Existing submission returned for an idempotent retry',
      ...swaggerSuccessEnvelope(submissionViewSchema, 'Submission already registered'),
    },
    400: {
      description: 'Invalid payload, objectKey, or contest not ACTIVE',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role or objectKey ownership',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Contest not found',
      ...swaggerErrorEnvelope('Contest not found'),
    },
    409: {
      description: 'objectKey already registered to another creator',
      ...swaggerErrorEnvelope('objectKey is already registered'),
    },
  },
};

export const listMySubmissionsSwaggerSchema: FastifySchema = {
  tags: ['Submissions'],
  summary: 'List the authenticated creator submissions',
  description: `${creatorOnlyDescription} Returns only rows owned by the JWT user id.`,
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Creator submissions',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: submissionViewSchema },
        'Submissions retrieved successfully',
      ),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role',
      ...swaggerErrorEnvelope('Forbidden'),
    },
  },
};

export const getSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Submissions'],
  summary: 'Get one of the authenticated creator submissions',
  description: `${creatorOnlyDescription} Other creators' submissions return 404. Admin moderation reads are M07.`,
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      description: 'Submission retrieved',
      ...swaggerSuccessEnvelope(
        submissionViewSchema,
        'Submission retrieved successfully',
      ),
    },
    400: {
      description: 'Invalid id',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Submission not found',
      ...swaggerErrorEnvelope('Submission not found'),
    },
  },
};
