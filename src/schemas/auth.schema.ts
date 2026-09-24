import { z } from 'zod';
import { FastifySchema } from 'fastify';

// -------------------------------------------------------------
// 1. Zod Validation Schemas & Inferred Types
// -------------------------------------------------------------

/**
 * Creator register body (M02-P01-T06).
 * Accepted keys: `email`, `password`, `name` only.
 * `handle` / `avatarUrl` are NOT part of this contract (dropped explicitly:
 * FE creator form still collects `username`, but persistence is PLANNED /
 * NOT SPECIFIED — see M02-P01-T05). Extra keys are stripped by Zod, not stored.
 * Password min length 6 is the existing Zod constraint; source password
 * policy is NOT SPECIFIED and is not changed here.
 */
export const registerCreatorSchema = z.object({
  email: z.string().trim().email('Invalid email address format').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name cannot exceed 100 characters'),
});

export type RegisterCreatorInput = z.infer<typeof registerCreatorSchema>;

export const registerBrandSchema = z.object({
  email: z.string().trim().email('Invalid email address format').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name cannot exceed 100 characters'),
  organizationName: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters long')
    .max(100, 'Organization name cannot exceed 100 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Slug must be at least 2 characters long')
    .max(50, 'Slug cannot exceed 50 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase alphanumeric characters and hyphens',
    ),
});

export type RegisterBrandInput = z.infer<typeof registerBrandSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address format').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// -------------------------------------------------------------
// 2. Swagger / OpenAPI JSON Schema Definitions
// -------------------------------------------------------------

export const SwaggerUserSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    },
    email: {
      type: 'string',
      format: 'email',
      example: 'creator@contestos.com',
    },
    name: { type: 'string', example: 'Alex Rivers' },
    role: {
      type: 'string',
      enum: ['SUPER_ADMIN', 'BRAND_ADMIN', 'CREATOR', 'VIEWER'],
      example: 'CREATOR',
    },
    organizationId: { type: 'string', nullable: true, example: null },
    organization: {
      type: 'object',
      nullable: true,
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
        },
        name: { type: 'string', example: 'Ripskis Entertainment' },
        slug: { type: 'string', example: 'ripskis' },
        branding: {
          type: 'object',
          nullable: true,
          example: {
            primaryColor: '#FF5722',
            logoUrl: 'https://ripskis.com/logo.png',
          },
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-09-17T12:00:00.000Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-09-17T12:00:00.000Z',
        },
      },
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-09-17T12:00:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-09-17T12:00:00.000Z',
    },
  },
};

export const SwaggerOrganizationSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
    },
    name: { type: 'string', example: 'Ripskis Entertainment' },
    slug: { type: 'string', example: 'ripskis' },
    branding: {
      type: 'object',
      nullable: true,
      example: {
        primaryColor: '#FF5722',
        logoUrl: 'https://ripskis.com/logo.png',
      },
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-09-17T12:00:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-09-17T12:00:00.000Z',
    },
  },
};

export const SwaggerTokenProperty = {
  type: 'string',
  description: 'JWT Bearer access token',
  example:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImExYjJjM2Q0LWU1ZjYtNzg5MC1hYmNkLWVmMTIzNDU2Nzg5MCIsImVtYWlsIjoiY3JlYXRvckBjb250ZXN0b3MuY29tIiwicm9sZSI6IkNSRUFUT1IiLCJvcmdhbml6YXRpb25JZCI6bnVsbCwiaWF0IjoxNzg5NjU2MDAwLCJleHAiOjE3OTAyNjA4MDB9.sampleSignature',
};

export function swaggerSuccessEnvelope(
  dataSchema: Record<string, unknown>,
  messageExample = 'Operation completed successfully',
) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: messageExample },
      data: dataSchema,
      errors: { type: 'null', example: null },
    },
  };
}

export function swaggerErrorEnvelope(
  messageExample: string,
  errorExamples: unknown = null,
) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: messageExample },
      data: { type: 'null', example: null },
      errors: {
        nullable: true,
        example: errorExamples,
      },
    },
  };
}

// -------------------------------------------------------------
// 3. Fastify Endpoint Schemas
// -------------------------------------------------------------

export const registerCreatorSwaggerSchema: FastifySchema = {
  tags: ['Authentication'],
  summary: 'Register a new Creator account',
  description:
    'Creates a creator user with role CREATOR, hashes password with bcrypt (10 rounds), and issues a JWT token. Request body is email, password, and name only. handle and avatarUrl are not accepted (M02-P01-T06; persistence PLANNED / NOT SPECIFIED).',
  body: {
    type: 'object',
    required: ['email', 'password', 'name'],
    properties: {
      email: { type: 'string', format: 'email', example: 'creator@contestos.com' },
      password: { type: 'string', minLength: 6, example: 'CreatorPass123!' },
      name: { type: 'string', minLength: 2, maxLength: 100, example: 'Alex Rivers' },
    },
  },
  response: {
    201: {
      description: 'Creator successfully registered',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            user: SwaggerUserSchema,
            token: SwaggerTokenProperty,
          },
        },
        'Creator account created successfully',
      ),
    },
    400: {
      description: 'Bad Request - Validation error',
      ...swaggerErrorEnvelope('Validation error', [
        { field: 'email', message: 'Invalid email address format' },
      ]),
    },
    409: {
      description: 'Conflict - Email already registered',
      ...swaggerErrorEnvelope('User with this email already exists'),
    },
  },
};

export const registerBrandSwaggerSchema: FastifySchema = {
  tags: ['Authentication'],
  summary: 'Register a Brand organization & Brand Admin',
  description:
    'Atomically creates an Organization record and associated BRAND_ADMIN user inside a database transaction, returning organization profile, user profile, and JWT token.',
  body: {
    type: 'object',
    required: ['email', 'password', 'name', 'organizationName', 'slug'],
    properties: {
      email: { type: 'string', format: 'email', example: 'admin@ripskis.com' },
      password: { type: 'string', minLength: 6, example: 'BrandAdminSecure123!' },
      name: { type: 'string', minLength: 2, maxLength: 100, example: 'Jordan Vance' },
      organizationName: {
        type: 'string',
        minLength: 2,
        maxLength: 100,
        example: 'Ripskis Entertainment',
      },
      slug: {
        type: 'string',
        minLength: 2,
        maxLength: 50,
        pattern: '^[a-z0-9-]+$',
        example: 'ripskis',
      },
    },
  },
  response: {
    201: {
      description: 'Brand organization and admin successfully created',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            user: SwaggerUserSchema,
            organization: SwaggerOrganizationSchema,
            token: SwaggerTokenProperty,
          },
        },
        'Brand organization and admin created successfully',
      ),
    },
    400: {
      description: 'Bad Request - Validation error',
      ...swaggerErrorEnvelope('Validation error'),
    },
    409: {
      description: 'Conflict - Slug or email already exists',
      ...swaggerErrorEnvelope('Organization with this slug already exists'),
    },
  },
};

export const loginSwaggerSchema: FastifySchema = {
  tags: ['Authentication'],
  summary: 'Authenticate user & obtain JWT access token',
  description:
    'Authenticates user credentials, verifies bcrypt hash, and returns sanitized profile details along with a 7-day JWT access token.',
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'creator@contestos.com' },
      password: { type: 'string', example: 'CreatorPass123!' },
    },
  },
  response: {
    200: {
      description: 'Authentication successful',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            user: SwaggerUserSchema,
            token: SwaggerTokenProperty,
          },
        },
        'Login successful',
      ),
    },
    400: {
      description: 'Bad Request - Validation error',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Unauthorized - Invalid email or password',
      ...swaggerErrorEnvelope('Invalid email or password'),
    },
  },
};

export const getMeSwaggerSchema: FastifySchema = {
  tags: ['Authentication'],
  summary: 'Get current authenticated user profile',
  description:
    'Guarded endpoint requiring a valid Bearer JWT. Returns current authenticated user session data and associated organization details.',
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Current user profile retrieved successfully',
      ...swaggerSuccessEnvelope(SwaggerUserSchema, 'User profile retrieved successfully'),
    },
    401: {
      description: 'Unauthorized - Missing or invalid credentials',
      ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
    },
    404: {
      description: 'Not Found - User account no longer exists',
      ...swaggerErrorEnvelope('User profile not found'),
    },
  },
};
