import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * Organization.branding JSON (M04-P01-T04).
 *
 * Required keys match docs/knowledge/data-model.md §3:
 * `primaryColor` and `logoUrl`. Optional keys are the other documented
 * properties only. Unknown keys are rejected (`.strict()`), so slug, name,
 * status, and frontend-only fields such as `backgroundStyle` are not stored
 * in this document.
 *
 * Hex pattern and logo URI format are the data-model constraints.
 * Max lengths for `fontFamily` and `tagline` are NOT SPECIFIED and are not invented.
 */

const hexColorSchema = z
  .string()
  .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Must be a hex color (#RGB or #RRGGBB)');

export const organizationBrandingSchema = z
  .object({
    primaryColor: hexColorSchema,
    secondaryColor: hexColorSchema.optional(),
    accentColor: hexColorSchema.optional(),
    backgroundColor: hexColorSchema.optional(),
    fontFamily: z.string().optional(),
    logoUrl: z.string().url('logoUrl must be a valid URI'),
    bannerUrl: z.string().url('bannerUrl must be a valid URI').optional(),
    tagline: z.string().optional(),
  })
  .strict();

export type OrganizationBrandingInput = z.infer<typeof organizationBrandingSchema>;

/**
 * Slug format matches brand registration (`registerBrandSchema`).
 */
export const organizationSlugParamSchema = z.object({
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

export type OrganizationSlugParamInput = z.infer<typeof organizationSlugParamSchema>;

export const organizationIdParamSchema = z.object({
  id: z.string().uuid('Organization ID must be a valid UUID format'),
});

export type OrganizationIdParamInput = z.infer<typeof organizationIdParamSchema>;

/**
 * M10 lists no query parameters for the tenant list, so any key is a 400.
 * Pagination, search, filter, and sort are NOT SPECIFIED.
 */
export const superAdminOrganizationsQuerySchema = z.object({}).strict();

/**
 * Suspend body (M10-P01-T02). Reason is required free text: no reason
 * taxonomy exists (progress Amendment 2026-09-25). Max length is NOT SPECIFIED.
 */
export const suspendOrganizationSchema = z
  .object({
    reason: z.string().trim().min(1, 'Suspension reason is required'),
  })
  .strict();

export type SuspendOrganizationInput = z.infer<typeof suspendOrganizationSchema>;

/** Reinstate takes no fields (M10-P01-T03). */
export const reinstateOrganizationSchema = z.object({}).strict();

const brandingPropertySchema = {
  type: 'object',
  additionalProperties: true,
  nullable: true,
  properties: {
    primaryColor: { type: 'string', example: '#FF5722' },
    secondaryColor: { type: 'string', example: '#111827' },
    accentColor: { type: 'string', example: '#fbbf24' },
    backgroundColor: { type: 'string', example: '#090d16' },
    fontFamily: { type: 'string', example: 'Inter' },
    logoUrl: { type: 'string', format: 'uri', example: 'https://ripskis.com/logo.png' },
    bannerUrl: {
      type: 'string',
      format: 'uri',
      example: 'https://ripskis.com/banner.png',
    },
    tagline: { type: 'string', example: 'High-octane comedy showdowns' },
  },
};

const organizationBrandingViewSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
    },
    name: { type: 'string', example: 'Ripskis Entertainment' },
    slug: { type: 'string', example: 'ripskis' },
    branding: brandingPropertySchema,
    status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'], example: 'ACTIVE' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const organizationAdminViewSchema = {
  type: 'object',
  properties: {
    ...organizationBrandingViewSchema.properties,
    suspendedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
    suspensionReason: { type: 'string', nullable: true, example: null },
  },
};

const organizationIdParamsSwagger = {
  type: 'object',
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
    },
  },
};

const superAdminAuthErrors = {
  401: {
    description: 'Unauthorized',
    ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
  },
  403: {
    description: 'Forbidden (role is not SUPER_ADMIN)',
    ...swaggerErrorEnvelope(
      "Forbidden: User role 'BRAND_ADMIN' does not have permission to access this resource",
    ),
  },
};

/**
 * GET is public (M04-P02-T01).
 *
 * api-map lists this route without an Auth role. PUT lists BRAND_ADMIN and
 * SUPER_ADMIN. Theme tokens are viewer-facing (Ch 13.13: logos and colors).
 * `useTenantTheme` runs before login. This route does not call `authenticate`.
 * A Bearer token, valid or not, is ignored because `jwtVerify` is not invoked.
 *
 * Missing organization → 404. `branding: null` is a successful read (column is
 * optional). GET does not reject historical JSON that predates this schema
 * (for example a seed key `themeColor`). PUT is what enforces the schema.
 */
export const getOrganizationBrandingSwaggerSchema: FastifySchema = {
  tags: ['Organizations'],
  summary: 'Get organization branding by slug',
  description:
    'Public read of tenant theme tokens. No authentication. Returns organization id, name, slug, and branding JSON. branding may be null when the organization has not saved a theme. Does not include users.',
  params: {
    type: 'object',
    required: ['slug'],
    properties: {
      slug: { type: 'string', example: 'ripskis' },
    },
  },
  response: {
    200: {
      description: 'Organization branding retrieved',
      ...swaggerSuccessEnvelope(
        organizationBrandingViewSchema,
        'Organization branding retrieved successfully',
      ),
    },
    400: {
      description: 'Invalid slug',
      ...swaggerErrorEnvelope('Validation error'),
    },
    404: {
      description: 'Organization not found',
      ...swaggerErrorEnvelope('Organization not found'),
    },
  },
};

/**
 * SUPER_ADMIN tenant list (M10-P01-T01).
 * Route guard: authenticate + authorizeRoles(SUPER_ADMIN). BRAND_ADMIN,
 * CREATOR, and VIEWER → 403. Missing/invalid token → 401.
 * Items use the branding view, so users and credentials are never serialized.
 */
export const listSuperAdminOrganizationsSwaggerSchema: FastifySchema = {
  tags: ['Super Admin'],
  summary: 'List all organizations',
  description:
    'Cross-tenant list of every organization. Requires Bearer JWT and role SUPER_ADMIN. Returns id, name, slug, branding, status, suspendedAt, suspensionReason, createdAt, and updatedAt for each organization, newest first. No query parameters; any query key is rejected with 400. No pagination.',
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Organizations retrieved',
      ...swaggerSuccessEnvelope(
        { type: 'array', items: organizationAdminViewSchema },
        'Organizations retrieved successfully',
      ),
    },
    400: {
      description: 'Unknown query parameter',
      ...swaggerErrorEnvelope('Validation error'),
    },
    ...superAdminAuthErrors,
  },
};

/**
 * M10-P01-T02. authenticate + authorizeRoles(SUPER_ADMIN). No tenant scope
 * applies to SUPER_ADMIN. Missing organization → 404. Already suspended → 409.
 */
export const suspendOrganizationSwaggerSchema: FastifySchema = {
  tags: ['Super Admin'],
  summary: 'Suspend an organization',
  description:
    'Sets status SUSPENDED, suspendedAt to the current time, and suspensionReason to the required free-text reason. Requires Bearer JWT and role SUPER_ADMIN. An organization that is already suspended returns 409. No audit log row is written (not required by the M10 plan).',
  security: [{ bearerAuth: [] }],
  params: organizationIdParamsSwagger,
  body: {
    type: 'object',
    required: ['reason'],
    additionalProperties: false,
    properties: {
      reason: { type: 'string', example: 'Unresolved copyright complaints' },
    },
  },
  response: {
    200: {
      description: 'Organization suspended',
      ...swaggerSuccessEnvelope(
        organizationAdminViewSchema,
        'Organization suspended successfully',
      ),
    },
    400: {
      description: 'Invalid id or missing reason',
      ...swaggerErrorEnvelope('Suspension reason is required'),
    },
    ...superAdminAuthErrors,
    404: {
      description: 'Organization not found',
      ...swaggerErrorEnvelope('Organization not found'),
    },
    409: {
      description: 'Organization already suspended',
      ...swaggerErrorEnvelope('Organization is already suspended'),
    },
  },
};

/**
 * M10-P01-T03. Sets ACTIVE and clears suspendedAt and suspensionReason.
 * Organization that is not suspended → 409.
 */
export const reinstateOrganizationSwaggerSchema: FastifySchema = {
  tags: ['Super Admin'],
  summary: 'Reinstate a suspended organization',
  description:
    'Sets status ACTIVE and clears suspendedAt and suspensionReason. Requires Bearer JWT and role SUPER_ADMIN. No request body is needed; an empty object is accepted and any field is rejected with 400. An organization that is not suspended returns 409.',
  security: [{ bearerAuth: [] }],
  params: organizationIdParamsSwagger,
  response: {
    200: {
      description: 'Organization reinstated',
      ...swaggerSuccessEnvelope(
        organizationAdminViewSchema,
        'Organization reinstated successfully',
      ),
    },
    400: {
      description: 'Invalid id or unknown body field',
      ...swaggerErrorEnvelope('Validation error'),
    },
    ...superAdminAuthErrors,
    404: {
      description: 'Organization not found',
      ...swaggerErrorEnvelope('Organization not found'),
    },
    409: {
      description: 'Organization is not suspended',
      ...swaggerErrorEnvelope('Organization is not suspended'),
    },
  },
};

/**
 * PUT replaces the branding document (M04-P02-T02).
 * Route guard: authenticate + authorizeRoles(BRAND_ADMIN, SUPER_ADMIN).
 * Service then allows SUPER_ADMIN for any existing organization and
 * BRAND_ADMIN only when JWT organizationId equals :id. Other organizations
 * → 403. Missing organization after an authorized actor → 404.
 */
export const updateOrganizationBrandingSwaggerSchema: FastifySchema = {
  tags: ['Organizations'],
  summary: 'Replace organization branding',
  description:
    'Replaces Organization.branding. Requires Bearer JWT and role BRAND_ADMIN (own organization only) or SUPER_ADMIN (any organization). primaryColor and logoUrl are required. Unknown JSON keys are rejected.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: 'e7a18492-91f2-4c22-9fa4-a4f61e890123',
      },
    },
  },
  body: {
    type: 'object',
    required: ['primaryColor', 'logoUrl'],
    additionalProperties: false,
    properties: {
      primaryColor: {
        type: 'string',
        pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
        example: '#FF5722',
      },
      secondaryColor: { type: 'string', pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' },
      accentColor: {
        type: 'string',
        pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
        example: '#fbbf24',
      },
      backgroundColor: { type: 'string', pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' },
      fontFamily: { type: 'string', example: 'Inter' },
      logoUrl: { type: 'string', format: 'uri', example: 'https://ripskis.com/logo.png' },
      bannerUrl: { type: 'string', format: 'uri' },
      tagline: { type: 'string', example: 'High-octane comedy showdowns' },
    },
  },
  response: {
    200: {
      description: 'Organization branding updated',
      ...swaggerSuccessEnvelope(
        organizationBrandingViewSchema,
        'Organization branding updated successfully',
      ),
    },
    400: {
      description: 'Validation error',
      ...swaggerErrorEnvelope('Validation error'),
    },
    401: {
      description: 'Unauthorized',
      ...swaggerErrorEnvelope('Unauthorized: Authentication required or token invalid'),
    },
    403: {
      description: 'Forbidden (wrong role or cross-tenant write)',
      ...swaggerErrorEnvelope(
        'Forbidden: Brand administrators can update branding only for their own organization',
      ),
    },
    404: {
      description: 'Organization not found',
      ...swaggerErrorEnvelope('Organization not found'),
    },
  },
};
