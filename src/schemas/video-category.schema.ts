import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const nameSchema = z.string().trim().min(1, 'Category name is required').max(80);
const descriptionSchema = z.string().trim().max(500).nullable().optional();

export const createVideoCategorySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateVideoCategorySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const videoCategoryIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export const listVideoCategoriesQuerySchema = z
  .object({
    search: z.string().trim().max(80).optional(),
    status: z.enum(['active', 'inactive', 'all']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  })
  .strict();

export type CreateVideoCategoryInput = z.infer<typeof createVideoCategorySchema>;
export type UpdateVideoCategoryInput = z.infer<typeof updateVideoCategorySchema>;
export type ListVideoCategoriesQuery = z.infer<typeof listVideoCategoriesQuerySchema>;

const categoryViewSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    submissionCount: { type: 'integer' },
    contestCount: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

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

const adminListSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: categoryViewSchema },
    pagination: paginationSchema,
  },
};

const activeListSchema = {
  type: 'array',
  items: categoryViewSchema,
};

export const listActiveVideoCategoriesSwaggerSchema: FastifySchema = {
  tags: ['Video Categories'],
  summary: 'List active official video categories',
  description:
    'Authenticated. Returns active categories only, ordered by name. Inactive categories are omitted so they cannot be newly selected. "Other" is not a stored category.',
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(
      activeListSchema,
      'Video categories retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
  },
};

export const listAdminVideoCategoriesSwaggerSchema: FastifySchema = {
  tags: ['Video Categories'],
  summary: 'List video categories for administrators',
  description:
    'ADMIN only. Search matches name or description. status is active, inactive, or all. Pagination uses the shared page and limit helper.',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      search: { type: 'string' },
      status: { type: 'string', enum: ['active', 'inactive', 'all'] },
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1 },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      adminListSchema,
      'Video categories retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const createVideoCategorySwaggerSchema: FastifySchema = {
  tags: ['Video Categories'],
  summary: 'Create an official video category',
  description:
    'ADMIN only. Name is required, trimmed, and unique case-insensitively. Description is optional. isActive defaults to true. Does not create a category from a creator Other label.',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      isActive: { type: 'boolean' },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(
      categoryViewSchema,
      'Video category created successfully',
    ),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    409: swaggerErrorEnvelope('A category with this name already exists'),
  },
};

export const updateVideoCategorySwaggerSchema: FastifySchema = {
  tags: ['Video Categories'],
  summary: 'Update a video category',
  description:
    'ADMIN only. Rename, description, and isActive are optional. At least one field is required. Deactivating a category keeps existing submissions and contests. Duplicate names return 409.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      isActive: { type: 'boolean' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      categoryViewSchema,
      'Video category updated successfully',
    ),
    400: swaggerErrorEnvelope('Validation error'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Category not found'),
    409: swaggerErrorEnvelope('A category with this name already exists'),
  },
};

export const deleteVideoCategorySwaggerSchema: FastifySchema = {
  tags: ['Video Categories'],
  summary: 'Delete an unused video category',
  description:
    'ADMIN only. Deletion is refused with 409 when any submission or contest still references the category. Associated videos are not deleted. Deactivate the category instead. No prior product deletion policy existed; this preserves existing data.',
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
        properties: { id: { type: 'string' }, deleted: { type: 'boolean' } },
      },
      'Video category deleted successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Category not found'),
    409: swaggerErrorEnvelope('Category is in use'),
  },
};
