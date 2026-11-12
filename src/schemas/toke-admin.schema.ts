import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { ReviewStatus } from '@prisma/client';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const uuid = (label: string) => z.string().uuid(`${label} must be a valid UUID`);

const secured = [{ bearerAuth: [] }];

export const tokeAdminAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    entityType: z
      .enum(['TESTER', 'APPLICATION', 'PRODUCT', 'CATEGORY', 'PROPOSAL', 'REVIEW'])
      .optional(),
    entityId: z.string().trim().optional(),
    actorId: uuid('actorId').optional(),
    action: z.string().trim().optional(),
    search: z.string().trim().optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
  })
  .strict();

export type TokeAdminAuditQuery = z.infer<typeof tokeAdminAuditQuerySchema>;

export const adminReviewListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(ReviewStatus).optional(),
    productId: uuid('productId').optional(),
    productTypeId: uuid('productTypeId').optional(),
    testerId: uuid('testerId').optional(),
    search: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    country: z.string().trim().optional(),
    dispensaryName: z.string().trim().optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
  })
  .strict();

export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

export const rejectReviewSchema = z
  .object({
    reason: z.string().trim().min(2, 'Rejection reason is required').max(2000),
  })
  .strict();

export type RejectReviewInput = z.infer<typeof rejectReviewSchema>;

export const disqualifyReviewSchema = z
  .object({
    reason: z.string().trim().min(2, 'Disqualification reason is required').max(2000),
  })
  .strict();

export type DisqualifyReviewInput = z.infer<typeof disqualifyReviewSchema>;

const error400 = swaggerErrorEnvelope('Validation error');
const error401 = swaggerErrorEnvelope('Unauthorized: Authentication required');
const error403 = swaggerErrorEnvelope('Forbidden: Admin capability required');
const error404 = swaggerErrorEnvelope('Not found');

const metricsData = {
  type: 'object',
  properties: {
    verifiedTestersCount: { type: 'integer' },
    pendingApplicationsCount: { type: 'integer' },
    activeProductsCount: { type: 'integer' },
    pendingProductsCount: { type: 'integer' },
    activeCategoriesCount: { type: 'integer' },
    pendingCategoryProposalsCount: { type: 'integer' },
    reviewsAwaitingApprovalCount: { type: 'integer' },
    publishedReviewsCount: { type: 'integer' },
    rejectedReviewsCount: { type: 'integer' },
    totalReviewsCount: { type: 'integer' },
    recentAuditLogs: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    counts: {
      type: 'object',
      properties: {
        verifiedTesters: { type: 'integer' },
        pendingApplications: { type: 'integer' },
        activeProducts: { type: 'integer' },
        pendingProducts: { type: 'integer' },
        activeCategories: { type: 'integer' },
        pendingCategoryProposals: { type: 'integer' },
        reviewsAwaitingApproval: { type: 'integer' },
        publishedReviews: { type: 'integer' },
        rejectedOrDisqualifiedReviews: { type: 'integer' },
        totalReviews: { type: 'integer' },
      },
    },
    recentAudit: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
  },
};

const paginatedData = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    pagination: { type: 'object', additionalProperties: true },
  },
};

export const getTokeAdminMetricsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'One Toke admin dashboard KPI metrics',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(metricsData),
    401: error401,
    403: error403,
  },
};

export const listTokeAdminAuditSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'List One Toke admin audit history',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(paginatedData),
    401: error401,
    403: error403,
  },
};

export const listAdminAllReviewsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'List all reviews across all statuses and testers',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(paginatedData),
    401: error401,
    403: error403,
  },
};

export const getAdminReviewDetailSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'Get complete review details for admin management',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object', additionalProperties: true }),
    401: error401,
    403: error403,
    404: error404,
  },
};

export const rejectAdminReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'Reject a submitted review with mandatory reason',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 2, maxLength: 2000 },
    },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object', additionalProperties: true }),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
  },
};

export const disqualifyAdminReviewSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'Disqualify / delist a published or approved review with mandatory reason',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 2, maxLength: 2000 },
    },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object', additionalProperties: true }),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
  },
};

export const testerIdParamSchema = z
  .object({
    id: uuid('testerId'),
  })
  .strict();

export type TesterIdParam = z.infer<typeof testerIdParamSchema>;

export const getAdminTesterDetailSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin'],
  summary: 'Get tester profile, review stats, and audit history',
  security: secured,
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object', additionalProperties: true }),
    401: error401,
    403: error403,
    404: error404,
  },
};
