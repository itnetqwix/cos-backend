import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const uuid = (label: string) => z.string().uuid(`${label} must be a valid UUID`);

export const APPLICATION_TEXT_LIMITS = {
  name: 100,
  email: 100,
  phone: 30,
  place: 80,
  bio: 2000,
  notes: 2000,
  url: 512,
} as const;

export const submitTesterApplicationSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters')
      .max(APPLICATION_TEXT_LIMITS.name),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(APPLICATION_TEXT_LIMITS.email),
    phoneNumber: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.phone)
      .nullable()
      .optional(),
    avatarUrl: z.string().trim().max(APPLICATION_TEXT_LIMITS.url).nullable().optional(),
    city: z.string().trim().max(APPLICATION_TEXT_LIMITS.place).nullable().optional(),
    state: z.string().trim().max(APPLICATION_TEXT_LIMITS.place).nullable().optional(),
    country: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.place)
      .default('USA')
      .optional(),
    bio: z.string().trim().max(APPLICATION_TEXT_LIMITS.bio).nullable().optional(),
    experienceYears: z.number().int().min(0).max(70).nullable().optional(),
    preferredProductTypes: z
      .array(z.string().trim().max(50))
      .max(20)
      .default([])
      .optional(),
    languages: z.array(z.string().trim().max(50)).max(10).default([]).optional(),
    credentials: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.notes)
      .nullable()
      .optional(),
    sampleReviewUrl: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.url)
      .nullable()
      .optional(),
    portfolioUrls: z
      .array(z.string().trim().max(APPLICATION_TEXT_LIMITS.url))
      .max(10)
      .default([])
      .optional(),
    applicantNotes: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.notes)
      .nullable()
      .optional(),
  })
  .strict();

export type SubmitTesterApplicationInput = z.infer<typeof submitTesterApplicationSchema>;

export const updateTesterApplicationSchema = submitTesterApplicationSchema
  .partial()
  .strict();
export type UpdateTesterApplicationInput = z.infer<typeof updateTesterApplicationSchema>;

export const respondInfoSchema = z
  .object({
    notes: z
      .string()
      .trim()
      .min(1, 'Response notes are required')
      .max(APPLICATION_TEXT_LIMITS.notes),
    credentials: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.notes)
      .nullable()
      .optional(),
    sampleReviewUrl: z
      .string()
      .trim()
      .max(APPLICATION_TEXT_LIMITS.url)
      .nullable()
      .optional(),
    portfolioUrls: z
      .array(z.string().trim().max(APPLICATION_TEXT_LIMITS.url))
      .max(10)
      .optional(),
    bio: z.string().trim().max(APPLICATION_TEXT_LIMITS.bio).nullable().optional(),
  })
  .strict();

export type RespondInfoInput = z.infer<typeof respondInfoSchema>;

export const requestInfoSchema = z
  .object({
    notes: z
      .string()
      .trim()
      .min(1, 'Requested information notes are required')
      .max(APPLICATION_TEXT_LIMITS.notes),
  })
  .strict();

export type RequestInfoInput = z.infer<typeof requestInfoSchema>;

export const rejectApplicationSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'A rejection reason is required')
      .max(APPLICATION_TEXT_LIMITS.notes),
  })
  .strict();

export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;

export const suspendTesterSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'A suspension reason is required')
      .max(APPLICATION_TEXT_LIMITS.notes),
  })
  .strict();

export type SuspendTesterInput = z.infer<typeof suspendTesterSchema>;

export const revokeTesterSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'A revocation reason is required')
      .max(APPLICATION_TEXT_LIMITS.notes),
  })
  .strict();

export type RevokeTesterInput = z.infer<typeof revokeTesterSchema>;

export const reinstateTesterSchema = z
  .object({
    notes: z.string().trim().max(APPLICATION_TEXT_LIMITS.notes).optional(),
  })
  .strict();

export type ReinstateTesterInput = z.infer<typeof reinstateTesterSchema>;

export const applicationIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strict();

export const testerIdParamSchema = z
  .object({
    id: uuid('id'),
  })
  .strict();

export const applicationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z
      .enum(['PENDING', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED'])
      .optional(),
    search: z.string().trim().optional(),
  })
  .strict();

export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

export const testerListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['NOT_VERIFIED', 'VERIFIED', 'SUSPENDED', 'REVOKED']).optional(),
    search: z.string().trim().optional(),
  })
  .strict();

export type TesterListQuery = z.infer<typeof testerListQuerySchema>;

const secured = [{ bearerAuth: [] }];
const error400 = swaggerErrorEnvelope('Validation error');
const error401 = swaggerErrorEnvelope('Unauthorized: Authentication required');
const error403 = swaggerErrorEnvelope('Forbidden: Admin or Review Approver required');
const error404 = swaggerErrorEnvelope('Application not found');
const error409 = swaggerErrorEnvelope(
  'Conflict: Invalid application transition or duplicate application',
);

const applicationData = { type: 'object', additionalProperties: true };
const testerData = { type: 'object', additionalProperties: true };

export const submitTesterApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Tester Onboarding'],
  summary: 'Submit a verified tester application',
  security: secured,
  response: {
    201: swaggerSuccessEnvelope(applicationData),
    400: error400,
    401: error401,
    409: error409,
  },
};

export const getMyApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Tester Onboarding'],
  summary: 'Get current user tester application and verification status',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    401: error401,
  },
};

export const updateMyApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Tester Onboarding'],
  summary: 'Update own pending application or respond to changes',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    400: error400,
    401: error401,
    409: error409,
  },
};

export const respondInfoSwaggerSchema: FastifySchema = {
  tags: ['One Toke Tester Onboarding'],
  summary: 'Respond to administrator information request',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    400: error400,
    401: error401,
    409: error409,
  },
};

export const listApplicationsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'List tester applications (Admin/Approver only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope({
      type: 'object',
      properties: {
        items: { type: 'array', items: applicationData },
        pagination: { type: 'object', additionalProperties: true },
      },
    }),
    401: error401,
    403: error403,
  },
};

export const getApplicationDetailsSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Get application details and audit trail (Admin/Approver only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    401: error401,
    403: error403,
    404: error404,
  },
};

export const reviewApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Mark application under review (Admin/Approver only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const requestInfoSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Request additional information from applicant (Admin/Approver only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const approveApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Approve tester application and activate verified tester access (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const rejectApplicationSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Reject tester application with reason (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(applicationData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const listTestersSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'List verified, suspended and revoked testers (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope({
      type: 'object',
      properties: {
        items: { type: 'array', items: testerData },
        pagination: { type: 'object', additionalProperties: true },
      },
    }),
    401: error401,
    403: error403,
  },
};

export const suspendTesterSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Suspend verified tester access (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(testerData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const revokeTesterSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Permanently revoke verified tester access (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(testerData),
    400: error400,
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const reinstateTesterSwaggerSchema: FastifySchema = {
  tags: ['One Toke Admin Testers'],
  summary: 'Reinstate suspended or revoked tester access (Admin only)',
  security: secured,
  response: {
    200: swaggerSuccessEnvelope(testerData),
    401: error401,
    403: error403,
    404: error404,
    409: error409,
  },
};

export const publicTesterQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

export type PublicTesterQuery = z.infer<typeof publicTesterQuerySchema>;

export const getPublicTesterProfileSwaggerSchema: FastifySchema = {
  tags: ['One Toke'],
  summary: 'Public verified tester profile',
  description:
    'No auth. Verified testers only. Returns public professional profile, authoring statistics, and paginated published reviews.',
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
    },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object', additionalProperties: true }),
    404: error404,
  },
};
