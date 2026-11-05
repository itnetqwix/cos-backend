import { z } from 'zod';
import { CategoryProposalStatus } from '@prisma/client';

export const proposeCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters'),
  description: z
    .string()
    .trim()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description cannot exceed 500 characters'),
});

export const createAdminCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters'),
  description: z.string().trim().max(500).optional().nullable(),
  defaultWeight: z
    .number()
    .positive('Weight must be greater than zero')
    .optional()
    .default(1.0),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateAdminCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters')
    .optional(),
  description: z.string().trim().max(500).optional().nullable(),
  defaultWeight: z.number().positive('Weight must be greater than zero').optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const approveProposalSchema = z.object({
  defaultWeight: z.number().positive('Weight must be greater than zero').optional(),
  sortOrder: z.number().int().optional(),
  reviewReason: z.string().trim().max(500).optional(),
});

export const rejectProposalSchema = z.object({
  rejectionReason: z.string().trim().min(2, 'Rejection reason is required').max(500),
});

export const mergeCategoriesSchema = z.object({
  sourceCategoryId: z.string().uuid('sourceCategoryId must be a valid UUID'),
  targetCategoryId: z.string().uuid('targetCategoryId must be a valid UUID'),
});

export const categoryIdParamSchema = z.object({
  id: z.string().uuid('Category id must be a valid UUID'),
});

export const proposalIdParamSchema = z.object({
  id: z.string().uuid('Proposal id must be a valid UUID'),
});

export const listAdminCategoriesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  search: z.string().trim().optional(),
});

export const listAdminProposalsQuerySchema = z.object({
  status: z.nativeEnum(CategoryProposalStatus).optional(),
});

// --- Swagger Schemas ---

export const listCategoriesSwaggerSchema = {
  description:
    'List all active approved review categories for scorecard authoring and display',
  tags: ['One Toke Categories'],
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              description: { type: 'string', nullable: true },
              defaultWeight: { type: 'number' },
              sortOrder: { type: 'integer' },
              isActive: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
};

export const getCategoryByIdSwaggerSchema = {
  description: 'Get details of a specific review category',
  tags: ['One Toke Categories'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

export const proposeCategorySwaggerSchema = {
  description: 'Tester proposal for a new review scorecard category',
  tags: ['One Toke Categories'],
  body: {
    type: 'object',
    required: ['name', 'description'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 50 },
      description: { type: 'string', minLength: 10, maxLength: 500 },
    },
  },
};

export const listMyProposalsSwaggerSchema = {
  description: 'List category proposals submitted by the current tester',
  tags: ['One Toke Categories'],
};

export const listAdminCategoriesSwaggerSchema = {
  description: 'Admin list of review categories with score usage and inactive status',
  tags: ['One Toke Admin Categories'],
  querystring: {
    type: 'object',
    properties: {
      includeInactive: { type: 'string', enum: ['true', 'false'] },
      search: { type: 'string' },
    },
  },
};

export const createAdminCategorySwaggerSchema = {
  description: 'Create a new review category directly as an admin',
  tags: ['One Toke Admin Categories'],
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 50 },
      description: { type: 'string', nullable: true },
      defaultWeight: { type: 'number', minimum: 0.01 },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },
};

export const updateAdminCategorySwaggerSchema = {
  description: 'Update review category metadata, weight, or active status',
  tags: ['One Toke Admin Categories'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

export const deactivateAdminCategorySwaggerSchema = {
  description: 'Safely deactivate a review category while preserving historical reviews',
  tags: ['One Toke Admin Categories'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

export const listAdminProposalsSwaggerSchema = {
  description: 'Admin view of pending, approved, and rejected category proposals',
  tags: ['One Toke Admin Categories'],
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
    },
  },
};

export const approveProposalSwaggerSchema = {
  description: 'Admin approval of a category proposal, adding it to the active scorecard',
  tags: ['One Toke Admin Categories'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    properties: {
      defaultWeight: { type: 'number', minimum: 0.01 },
      sortOrder: { type: 'integer' },
      reviewReason: { type: 'string' },
    },
  },
};

export const rejectProposalSwaggerSchema = {
  description: 'Admin rejection of a category proposal with required feedback reason',
  tags: ['One Toke Admin Categories'],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['rejectionReason'],
    properties: {
      rejectionReason: { type: 'string', minLength: 2, maxLength: 500 },
    },
  },
};

export const mergeCategoriesSwaggerSchema = {
  description: 'Admin merge of a source category into a target category',
  tags: ['One Toke Admin Categories'],
  body: {
    type: 'object',
    required: ['sourceCategoryId', 'targetCategoryId'],
    properties: {
      sourceCategoryId: { type: 'string', format: 'uuid' },
      targetCategoryId: { type: 'string', format: 'uuid' },
    },
  },
};
