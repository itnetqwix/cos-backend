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
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
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
