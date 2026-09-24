import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { Role } from '@prisma/client';
import {
  SwaggerUserSchema,
  swaggerSuccessEnvelope,
  swaggerErrorEnvelope,
} from './auth.schema.js';

// -------------------------------------------------------------
// 1. Zod Validation Schemas
// -------------------------------------------------------------

export const userParamSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID format'),
});

export type UserParamInput = z.infer<typeof userParamSchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  role: z.nativeEnum(Role).optional(),
});

export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;

// -------------------------------------------------------------
// 2. Fastify / Swagger Schemas for User Endpoints
// -------------------------------------------------------------

const PaginatedUsersSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: SwaggerUserSchema,
    },
    pagination: {
      type: 'object',
      properties: {
        totalCount: { type: 'integer', example: 42 },
        totalPages: { type: 'integer', example: 3 },
        currentPage: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
        hasNextPage: { type: 'boolean', example: true },
        hasPrevPage: { type: 'boolean', example: false },
      },
    },
  },
};

export const listUsersSwaggerSchema: FastifySchema = {
  tags: ['Users'],
  summary: 'List users with pagination & search',
  description:
    'Retrieves a paginated collection of users. Requires Bearer JWT and role SUPER_ADMIN. BRAND_ADMIN organization-scoped listing is NOT SPECIFIED and is not allowed on this endpoint. Self-profile is GET /auth/me.',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', default: 1, minimum: 1 },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      search: { type: 'string', description: 'Filter by name or email keyword' },
      role: {
        type: 'string',
        enum: ['SUPER_ADMIN', 'BRAND_ADMIN', 'CREATOR', 'VIEWER'],
      },
    },
  },
  response: {
    200: {
      description: 'Users retrieved successfully',
      ...swaggerSuccessEnvelope(
        PaginatedUsersSchema,
        'Users list retrieved successfully',
      ),
    },
    401: {
      description: 'Unauthorized',
      ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
    },
    403: {
      description: 'Forbidden',
      ...swaggerErrorEnvelope('Forbidden: Insufficient permissions'),
    },
  },
};

export const getUserByIdSwaggerSchema: FastifySchema = {
  tags: ['Users'],
  summary: 'Get user profile by unique ID',
  description:
    'Retrieves a user profile by ID. Requires Bearer JWT and role SUPER_ADMIN. Authenticated creators/admins load their own profile via GET /auth/me. BRAND_ADMIN scoped lookup is NOT SPECIFIED and is not allowed here.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      },
    },
  },
  response: {
    200: {
      description: 'User profile retrieved successfully',
      ...swaggerSuccessEnvelope(SwaggerUserSchema, 'User profile retrieved successfully'),
    },
    401: {
      description: 'Unauthorized',
      ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
    },
    403: {
      description: 'Forbidden',
      ...swaggerErrorEnvelope('Forbidden: Insufficient permissions'),
    },
    404: {
      description: 'Not Found',
      ...swaggerErrorEnvelope('User profile not found'),
    },
  },
};

// -------------------------------------------------------------
// 3. Fastify / Swagger Schemas for Base & System Endpoints
// -------------------------------------------------------------

export const healthSwaggerSchema: FastifySchema = {
  tags: ['System'],
  summary: 'Service operational health check',
  description: 'Returns operational health status and server timestamp.',
  response: {
    200: {
      description: 'API is healthy and online',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2026-09-17T12:00:00.000Z',
            },
          },
        },
        'Contest Operating System API is healthy',
      ),
    },
  },
};

export const rootSwaggerSchema: FastifySchema = {
  tags: ['System'],
  summary: 'API root information & version metadata',
  description: 'Returns API metadata, service name, and version.',
  response: {
    200: {
      description: 'API root information',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            version: { type: 'string', example: '1.0.0' },
            name: { type: 'string', example: 'Contest Operating System Backend' },
          },
        },
        'Hello World from Contest Operating System API!',
      ),
    },
  },
};
