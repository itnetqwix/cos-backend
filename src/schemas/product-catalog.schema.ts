import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { ProductApprovalStatus } from '@prisma/client';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const listProductsQuerySchema = z.object({
  search: z.string().trim().optional(),
  productTypeId: z.string().uuid().optional(),
  approvalStatus: z.nativeEnum(ProductApprovalStatus).optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.enum(['name', 'createdAt', 'brandName']).default('name'),
  orderDirection: z.enum(['asc', 'desc']).default('asc'),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(120),
  brandName: z.string().trim().min(1, 'Brand name is required').max(120),
  productTypeId: z.string().uuid('Valid product type UUID is required'),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  imageObjectKey: z.string().trim().optional().nullable(),
  strain: z.string().trim().max(120).optional().nullable(),
  batchNumber: z.string().trim().max(80).optional().nullable(),
  reportedThcPercent: z.number().min(0).max(100).optional().nullable(),
  reportedCbdPercent: z.number().min(0).max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brandName: z.string().trim().min(1).max(120).optional(),
  productTypeId: z.string().uuid().optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  imageObjectKey: z.string().trim().optional().nullable(),
  strain: z.string().trim().max(120).optional().nullable(),
  batchNumber: z.string().trim().max(80).optional().nullable(),
  reportedThcPercent: z.number().min(0).max(100).optional().nullable(),
  reportedCbdPercent: z.number().min(0).max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const rejectProductSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Rejection reason must be at least 3 characters')
    .max(1000),
});

export const presignProductImageSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});

export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type RejectProductInput = z.infer<typeof rejectProductSchema>;
export type PresignProductImageInput = z.infer<typeof presignProductImageSchema>;

// Swagger Schemas
const secured = [{ bearerAuth: [] }];
const error400 = swaggerErrorEnvelope('Validation error');
const error401 = swaggerErrorEnvelope('Authentication required');
const error403 = swaggerErrorEnvelope('Forbidden access');
const error404 = swaggerErrorEnvelope('Product not found');
const error409 = swaggerErrorEnvelope('Conflict: duplicate product');

const productData = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    brandName: { type: 'string' },
    productTypeId: { type: 'string' },
    description: { type: 'string', nullable: true },
    imageUrl: { type: 'string', nullable: true },
    imageObjectKey: { type: 'string', nullable: true },
    strain: { type: 'string', nullable: true },
    batchNumber: { type: 'string', nullable: true },
    reportedThcPercent: { type: 'number', nullable: true },
    reportedCbdPercent: { type: 'number', nullable: true },
    isActive: { type: 'boolean' },
    approvalStatus: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
    submittedById: { type: 'string', nullable: true },
    rejectionReason: { type: 'string', nullable: true },
    reviewedById: { type: 'string', nullable: true },
    reviewedAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    productType: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
      },
    },
    _count: {
      type: 'object',
      properties: {
        reviews: { type: 'number' },
      },
    },
  },
};

export const getProductTypesSwaggerSchema: FastifySchema = {
  tags: ['One Toke Catalog'],
  summary: 'List active cannabis product types',
  response: {
    200: swaggerSuccessEnvelope({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          isActive: { type: 'boolean' },
        },
      },
    }),
  },
};

export const listProductsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Catalog'],
  summary: 'Search and filter active products in the catalog',
  response: {
    200: swaggerSuccessEnvelope({
      type: 'object',
      properties: {
        items: { type: 'array', items: productData },
        pagination: { type: 'object', additionalProperties: true },
      },
    }),
  },
};

export const getProductByIdSwaggerSchema: FastifySchema = {
  tags: ['One Toke Catalog'],
  summary: 'Fetch active product details by id',
  response: {
    200: swaggerSuccessEnvelope(productData),
    404: error404,
  },
};

export const submitProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Catalog'],
  summary: 'Submit a new product entry for editorial review (Verified Tester)',
  security: secured,
  response: {
    201: swaggerSuccessEnvelope(productData),
    400: error400,
    401: error401,
    403: error403,
    409: error409,
  },
};

export const presignProductImageSwaggerSchema: FastifySchema = {
  tags: ['One Toke Catalog'],
  summary: 'Presign S3 direct upload for a product photo',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope({
      type: 'object',
      properties: {
        uploadUrl: { type: 'string' },
        objectKey: { type: 'string' },
        publicUrl: { type: 'string' },
        headers: { type: 'object', additionalProperties: true },
        expiresInSeconds: { type: 'number' },
        method: { type: 'string' },
      },
    }),
    400: error400,
    401: error401,
    403: error403,
  },
};

export const listAdminProductsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'List products with admin filters, pending submissions, and inactive entries',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope({
      type: 'object',
      properties: {
        items: { type: 'array', items: productData },
        pagination: { type: 'object', additionalProperties: true },
      },
    }),
    401: error401,
    403: error403,
  },
};

export const createAdminProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'Create an active product directly into the catalog (Admin only)',
  security: secured,
  response: {
    201: swaggerSuccessEnvelope(productData),
    400: error400,
    401: error401,
    403: error403,
    409: error409,
  },
};

export const updateAdminProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'Update product information or active status (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(productData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const approveAdminProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'Approve a tester-submitted pending product (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(productData),
    401: error401,
    403: error403,
    404: error404,
  },
};

export const rejectAdminProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'Reject a pending product submission with feedback (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(productData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
  },
};

export const deactivateAdminProductSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Catalog'],
  summary: 'Archive / deactivate a product safely without breaking reviews (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(productData),
    401: error401,
    403: error403,
    404: error404,
  },
};
