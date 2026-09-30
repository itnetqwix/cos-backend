import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * Contest HTTP contracts (M05-P03-T01).
 *
 * Persisted fields match the Prisma Contest model. Not accepted:
 * submission/upload fields, prize distribution breakdown, media constraints,
 * votingCloseDate, entries, votes, or a status on create (create always
 * stores DRAFT). Optional tagline, bannerUrl, and thumbnailUrl are stored.
 *
 * `rules` is a JSON string or a string array (domain model: JSON / string array).
 * Evaluation criteria are NOT SPECIFIED as a column. Unknown keys, including
 * `criteria` / `scoringCriteria`, are rejected.
 *
 * `endDate` must be later than `startDate` so the documented submission window
 * (`startDate <= now <= endDate`) can exist.
 *
 * Optional creator-facing fields collected by the admin form and stored on
 * Contest: tagline, bannerUrl, thumbnailUrl. Prize breakdown, media
 * constraints, and votingCloseDate are still not columns.
 */

export const CONTEST_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'JUDGING',
  'COMPLETED',
  'ARCHIVED',
] as const;

export const contestStatusSchema = z.enum(CONTEST_STATUSES);

const isoDateTimeSchema = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}, 'Must be an ISO 8601 date-time');

const rulesSchema = z.union([z.string(), z.array(z.string())]);

const optionalVisualText = z.string().trim().max(2000).nullable().optional();

const categorySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Category slug is required')
  .max(50, 'Category slug cannot exceed 50 characters')
  .regex(
    /^[a-z0-9-]+$/,
    'Category slug can only contain lowercase alphanumeric characters and hyphens',
  );

export const categoryWriteSchema = z
  .object({
    name: z.string().trim().min(1, 'Category name is required'),
    slug: categorySlugSchema.optional(),
    description: z.string().optional(),
  })
  .strict();

export const createContestSchema = z
  .object({
    categoryId: z.string().uuid('categoryId must be a valid UUID').optional(),
    category: categoryWriteSchema.optional(),
    title: z.string().trim().min(1, 'Title is required'),
    description: z.string().trim().min(1, 'Description is required'),
    tagline: optionalVisualText,
    bannerUrl: optionalVisualText,
    thumbnailUrl: optionalVisualText,
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema,
    prizeSummary: z.string().nullable().optional(),
    rules: rulesSchema.nullable().optional(),
    autoAdvanceDelayMs: z.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.endDate) > Date.parse(value.startDate), {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })
  .refine((value) => !(value.categoryId && value.category), {
    message: 'Provide either categoryId or category, not both',
    path: ['category'],
  });

export type CreateContestInput = z.infer<typeof createContestSchema>;

export const updateContestSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').optional(),
    description: z.string().trim().min(1, 'Description is required').optional(),
    tagline: optionalVisualText,
    bannerUrl: optionalVisualText,
    thumbnailUrl: optionalVisualText,
    startDate: isoDateTimeSchema.optional(),
    endDate: isoDateTimeSchema.optional(),
    prizeSummary: z.string().nullable().optional(),
    rules: rulesSchema.nullable().optional(),
    autoAdvanceDelayMs: z.number().int().positive().optional(),
    status: contestStatusSchema.optional(),
    categoryId: z.string().uuid('categoryId must be a valid UUID').nullable().optional(),
    category: categoryWriteSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })
  .refine((value) => !(value.categoryId && value.category), {
    message: 'Provide either categoryId or category, not both',
    path: ['category'],
  });

export type UpdateContestInput = z.infer<typeof updateContestSchema>;

export const contestIdParamSchema = z.object({
  id: z.string().uuid('Contest ID must be a valid UUID format'),
});

export type ContestIdParamInput = z.infer<typeof contestIdParamSchema>;

export const listContestsQuerySchema = z
  .object({
    status: contestStatusSchema.optional(),
    category: categorySlugSchema.optional(),
  })
  .strict();

export type ListContestsQueryInput = z.infer<typeof listContestsQuerySchema>;

const categoryViewSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string', nullable: true },
  },
};

const contestViewSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid', nullable: true },
    category: categoryViewSchema,
    title: { type: 'string' },
    description: { type: 'string' },
    tagline: { type: 'string', nullable: true },
    bannerUrl: { type: 'string', nullable: true },
    thumbnailUrl: { type: 'string', nullable: true },
    status: { type: 'string', enum: [...CONTEST_STATUSES] },
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: 'string', format: 'date-time' },
    prizeSummary: { type: 'string', nullable: true },
    rules: {
      anyOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
        { type: 'null' },
      ],
    },
    autoAdvanceDelayMs: { type: 'integer', example: 1800 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const contestWriteBody = {
  type: 'object',
  properties: {
    categoryId: { type: 'string', format: 'uuid' },
    category: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
    },
    title: { type: 'string' },
    description: { type: 'string' },
    tagline: { type: 'string', nullable: true },
    bannerUrl: { type: 'string', nullable: true },
    thumbnailUrl: { type: 'string', nullable: true },
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: 'string', format: 'date-time' },
    prizeSummary: { type: 'string', nullable: true },
    rules: {},
    autoAdvanceDelayMs: { type: 'integer' },
  },
};

/**
 * GET /contests and GET /contests/:id use the same roles as POST.
 * api-map does not name a role for the reads. CREATOR/VIEWER visibility,
 * including whether drafts are public, is NOT SPECIFIED. Granting those
 * roles or leaving the list public would publish unpublished configuration.
 * Ch 11.3 primary users are administrators and organizations.
 */
export const listContestsSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'List contests',
  description:
    'Lists contests for ADMIN. Query filters: status, category (slug). CREATOR is forbidden. Unauthenticated requests are 401.',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...CONTEST_STATUSES] },
      category: { type: 'string' },
    },
  },
  response: {
    200: {
      description: 'Contests retrieved',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: contestViewSchema },
        'Contests retrieved successfully',
      ),
    },
    400: {
      description: 'Invalid query',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role or wrong organization',
      ...swaggerErrorEnvelope('Forbidden'),
    },
  },
};

export const listDeploymentActiveContestsSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'List ACTIVE contests for this deployment',
  description:
    'Public. No authentication. Returns every ACTIVE contest. The client cannot pass an organization, brand, domain, or tenant.',
  querystring: {
    type: 'object',
    additionalProperties: false,
  },
  response: {
    200: {
      description: 'Active contests for this deployment',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: contestViewSchema },
        'Active contests retrieved successfully',
      ),
    },
    400: {
      description: 'Unexpected query',
      ...swaggerErrorEnvelope('Validation error'),
    },
    404: {
      description: 'Unexpected query',
      ...swaggerErrorEnvelope('Not found'),
    },
  },
};

export const createContestSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'Create a contest',
  description:
    'Creates a DRAFT contest. Auth: ADMIN. Status cannot be set on create. endDate must be after startDate. autoAdvanceDelayMs defaults to 1800.',
  security: [{ bearerAuth: [] }],
  body: {
    ...contestWriteBody,
    required: ['title', 'description', 'startDate', 'endDate'],
  },
  response: {
    201: {
      description: 'Contest created',
      ...swaggerSuccessEnvelope(contestViewSchema, 'Contest created successfully'),
    },
    400: {
      description: 'Invalid payload',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role or wrong organization',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Category not found',
      ...swaggerErrorEnvelope('Category not found'),
    },
    409: {
      description: 'Organization is suspended (M10)',
      ...swaggerErrorEnvelope(
        'Organization is suspended: contest changes are blocked until it is reinstated',
      ),
    },
  },
};

export const getContestSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'Get a contest',
  description:
    'Returns one contest. ADMIN may read any contest. CREATOR is forbidden. Missing id is 404.',
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
      description: 'Contest retrieved',
      ...swaggerSuccessEnvelope(contestViewSchema, 'Contest retrieved successfully'),
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
      description: 'Wrong role or wrong organization',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Contest not found',
      ...swaggerErrorEnvelope('Contest not found'),
    },
  },
};

export const updateContestSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'Update contest metadata or status',
  description:
    'Patches metadata and/or moves status one documented step. ADMIN only. Settings, category, and rules are rejected once status is ACTIVE (BR-CONT-04). COMPLETED and ARCHIVED reject metadata changes (BR-CONT-05). COMPLETED may move to ARCHIVED. ARCHIVED is terminal.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: contestWriteBody,
  response: {
    200: {
      description: 'Contest updated',
      ...swaggerSuccessEnvelope(contestViewSchema, 'Contest updated successfully'),
    },
    400: {
      description: 'Invalid payload',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Missing or invalid token',
      ...swaggerErrorEnvelope('Unauthorized'),
    },
    403: {
      description: 'Wrong role or wrong organization',
      ...swaggerErrorEnvelope('Forbidden'),
    },
    404: {
      description: 'Contest not found',
      ...swaggerErrorEnvelope('Contest not found'),
    },
    409: {
      description: 'Illegal transition, settings lock, or suspended organization (M10)',
      ...swaggerErrorEnvelope('Invalid contest status transition'),
    },
  },
};

const deletedContestSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
};

export const deleteContestSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'Delete a contest',
  description:
    'ADMIN only. ACTIVE and JUDGING contests are rejected. DRAFT, SCHEDULED, COMPLETED, and ARCHIVED may be deleted. Submissions and ratings for that contest cascade. Other contests and users are not deleted.',
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
      description: 'Contest deleted',
      ...swaggerSuccessEnvelope(deletedContestSchema, 'Contest deleted successfully'),
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
    409: {
      description: 'Contest state does not allow deletion',
      ...swaggerErrorEnvelope('Active contests cannot be deleted'),
    },
  },
};

export const listCreatorContestsSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'List contests for a creator',
  description:
    'CREATOR only. Returns every contest in this deployment, including drafts created by an admin. Does not accept an organization parameter.',
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Creator contest catalog',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: contestViewSchema },
        'Contests retrieved successfully',
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

export const getCreatorContestSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'Get one contest for a creator',
  description: 'CREATOR only. Returns the same contest view as the creator catalog.',
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
      description: 'Contest retrieved',
      ...swaggerSuccessEnvelope(contestViewSchema, 'Contest retrieved successfully'),
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

export const listViewableContestsSwaggerSchema: FastifySchema = {
  tags: ['Contests'],
  summary: 'List contests that can be watched',
  description:
    'Public. Returns ACTIVE, JUDGING, COMPLETED, and ARCHIVED contests. DRAFT and SCHEDULED are omitted. Rating is closed once a contest is COMPLETED or ARCHIVED.',
  response: {
    200: {
      description: 'Viewable contests',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: contestViewSchema },
        'Viewable contests retrieved successfully',
      ),
    },
  },
};
