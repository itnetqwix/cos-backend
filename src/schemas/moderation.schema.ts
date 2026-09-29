import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * Moderation HTTP contracts (M07-P02).
 *
 * Queue is PENDING_REVIEW only and tenant-scoped in the service.
 * Reject requires `reason` (BR-VID-02). `reasonCode` is optional and is
 * stored on the audit row metadata. Source chapters do not list category
 * codes, so this schema does not invent an allowlist.
 *
 * Approve accepts an optional note. A note is not required.
 * No flag, bulk, warning, or suspension body is defined here.
 */

export const submissionIdParamSchema = z.object({
  id: z.string().uuid('Submission id must be a valid UUID'),
});

export const approveSubmissionSchema = z
  .object({
    note: z.string().trim().min(1, 'Note cannot be empty').max(2000).optional(),
  })
  .strict();

export type ApproveSubmissionInput = z.infer<typeof approveSubmissionSchema>;

export const rejectSubmissionSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Rejection reason is required')
      .max(2000, 'Rejection reason cannot exceed 2000 characters'),
    reasonCode: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type RejectSubmissionInput = z.infer<typeof rejectSubmissionSchema>;

const submissionDataSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    contestId: { type: 'string' },
    creatorId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    videoUrl: { type: 'string' },
    objectKey: { type: 'string' },
    thumbnailUrl: { type: 'string', nullable: true },
    durationSeconds: { type: 'integer' },
    status: { type: 'string' },
    rejectionReason: { type: 'string', nullable: true },
    moderatedById: { type: 'string', nullable: true },
    moderatedAt: { type: 'string', nullable: true },
    tags: { type: 'array', items: { type: 'string' } },
    communityScore: { type: 'number' },
    totalVotes: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    contest: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
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
    },
    creator: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
};

const auditDataSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    submissionId: { type: 'string', nullable: true },
    actorId: { type: 'string' },
    action: { type: 'string' },
    reason: { type: 'string', nullable: true },
    metadata: { type: 'object', nullable: true, additionalProperties: true },
    createdAt: { type: 'string' },
    actor: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    submission: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        creatorName: { type: 'string', nullable: true },
      },
    },
  },
};

const guardsDescription =
  'Requires Authorization: Bearer <token>. ADMIN only. CREATOR receives 403.';

export const moderationQueueSwaggerSchema: FastifySchema = {
  tags: ['Moderation'],
  summary: 'List the pending-review moderation queue',
  description: `${guardsDescription} Returns submissions in PENDING_REVIEW only. Moderation SLA is NOT SPECIFIED.`,
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: submissionDataSchema },
      'Moderation queue retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized access'),
    403: swaggerErrorEnvelope('Forbidden access'),
  },
};

export const approveSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Moderation'],
  summary: 'Approve a pending submission',
  description: `${guardsDescription} Transitions PENDING_REVIEW to APPROVED and appends an AuditLog row with action APPROVE. Other statuses return 409. COMPLETED and ARCHIVED contests are read-only (409).`,
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      note: { type: 'string' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(submissionDataSchema, 'Submission approved'),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized access'),
    403: swaggerErrorEnvelope('Forbidden access'),
    404: swaggerErrorEnvelope('Submission not found'),
    409: swaggerErrorEnvelope('Invalid submission status transition'),
  },
};

export const rejectSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Moderation'],
  summary: 'Reject a pending submission',
  description: `${guardsDescription} Requires a non-empty reason (BR-VID-02). Transitions PENDING_REVIEW to REJECTED, stores rejectionReason, and appends an AuditLog row with action REJECT. Missing reason returns 400.`,
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['reason'],
    additionalProperties: false,
    properties: {
      reason: { type: 'string' },
      reasonCode: { type: 'string' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(submissionDataSchema, 'Submission rejected'),
    400: swaggerErrorEnvelope('Rejection reason is required'),
    401: swaggerErrorEnvelope('Unauthorized access'),
    403: swaggerErrorEnvelope('Forbidden access'),
    404: swaggerErrorEnvelope('Submission not found'),
    409: swaggerErrorEnvelope('Invalid submission status transition'),
  },
};

export const auditLogsSwaggerSchema: FastifySchema = {
  tags: ['Moderation'],
  summary: 'List moderation audit logs',
  description: `${guardsDescription} Append-only decision history. Retention is NOT SPECIFIED.`,
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: auditDataSchema },
      'Audit logs retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized access'),
    403: swaggerErrorEnvelope('Forbidden access'),
  },
};
