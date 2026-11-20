import { FastifySchema } from 'fastify';
import { z } from 'zod';
import {
  CannabisExperienceLevel,
  DatingGender,
  DatingIntention,
  DatingReportCategory,
  DatingReportStatus,
  LikeTargetType,
} from '@prisma/client';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';
import { DATING_IMAGE_CONTENT_TYPES } from '../services/storage.service.js';
import {
  DATING_COMMENT_MAX,
  DATING_CONSUMPTION_HABITS,
  DATING_MESSAGE_MAX,
  DATING_METHODS,
} from '../services/dating-constants.js';

const genderValues = Object.values(DatingGender) as [DatingGender, ...DatingGender[]];
const intentionValues = Object.values(DatingIntention) as [
  DatingIntention,
  ...DatingIntention[],
];
const experienceValues = Object.values(CannabisExperienceLevel) as [
  CannabisExperienceLevel,
  ...CannabisExperienceLevel[],
];
const likeTargets = Object.values(LikeTargetType) as [
  LikeTargetType,
  ...LikeTargetType[],
];
const reportCategories = Object.values(DatingReportCategory) as [
  DatingReportCategory,
  ...DatingReportCategory[],
];
const reportStatuses = Object.values(DatingReportStatus) as [
  DatingReportStatus,
  ...DatingReportStatus[],
];
const imageTypes = Object.keys(DATING_IMAGE_CONTENT_TYPES) as [
  keyof typeof DATING_IMAGE_CONTENT_TYPES,
  ...(keyof typeof DATING_IMAGE_CONTENT_TYPES)[],
];

const promptSchema = z.object({
  promptId: z.string().trim().min(1).max(64),
  question: z.string().trim().min(1).max(160),
  answer: z.string().trim().min(1).max(280),
});

export const datingOnboardingSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ageConfirmed: z.literal(true),
    gender: z.enum(genderValues),
    interestedIn: z.array(z.enum(genderValues)).min(1).max(5),
    datingIntention: z.enum(intentionValues).optional(),
    consumptionHabits: z.array(z.enum(DATING_CONSUMPTION_HABITS)).max(6).optional(),
    favoriteStrains: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    cannabisExperienceLevel: z.enum(experienceValues).optional(),
    favoriteMethods: z.array(z.enum(DATING_METHODS)).max(8).optional(),
    lifestyleInterests: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    bio: z.string().trim().max(1000).nullable().optional(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    country: z.string().trim().min(1).max(80).optional(),
    latitude: z.number().gte(-90).lte(90).optional(),
    longitude: z.number().gte(-180).lte(180).optional(),
    prompts: z.array(promptSchema).max(3).optional(),
    isIncognito: z.boolean().optional(),
    isDistanceHidden: z.boolean().optional(),
    isAgeHidden: z.boolean().optional(),
    preferences: z
      .object({
        minAge: z.number().int().min(18).max(99).optional(),
        maxAge: z.number().int().min(18).max(99).optional(),
        ageDealbreaker: z.boolean().optional(),
        maxDistanceMiles: z.number().int().min(5).max(100).optional(),
        distanceDealbreaker: z.boolean().optional(),
        targetGenders: z.array(z.enum(genderValues)).max(5).optional(),
        genderDealbreaker: z.boolean().optional(),
        cannabisHabitsFilter: z
          .array(z.enum(DATING_CONSUMPTION_HABITS))
          .max(6)
          .optional(),
        cannabisHabitsDealbreaker: z.boolean().optional(),
        intentionsFilter: z.array(z.enum(intentionValues)).max(5).optional(),
        intentionsDealbreaker: z.boolean().optional(),
        verifiedOnly: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export const datingProfilePatchSchema = datingOnboardingSchema.partial().strict();

export const datingStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'PAUSED']) })
  .strict();

export const datingIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const datingPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(reportStatuses).optional(),
  reasonCategory: z.enum(reportCategories).optional(),
});

export const datingPhotoPresignSchema = z
  .object({
    contentType: z.enum(imageTypes),
    fileSizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();

export const datingPhotoConfirmSchema = z
  .object({
    objectKey: z.string().trim().min(1).max(300),
    caption: z.string().trim().max(140).nullable().optional(),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    contentType: z.enum(imageTypes),
  })
  .strict();

export const datingPhotoReorderSchema = z
  .object({ photoIds: z.array(z.string().uuid()).min(1).max(6) })
  .strict();

export const datingPreferencesPatchSchema = z
  .object({
    minAge: z.number().int().min(18).max(99).optional(),
    maxAge: z.number().int().min(18).max(99).optional(),
    ageDealbreaker: z.boolean().optional(),
    maxDistanceMiles: z.number().int().min(5).max(100).optional(),
    distanceDealbreaker: z.boolean().optional(),
    targetGenders: z.array(z.enum(genderValues)).max(5).optional(),
    genderDealbreaker: z.boolean().optional(),
    cannabisHabitsFilter: z.array(z.enum(DATING_CONSUMPTION_HABITS)).max(6).optional(),
    cannabisHabitsDealbreaker: z.boolean().optional(),
    intentionsFilter: z.array(z.enum(intentionValues)).max(5).optional(),
    intentionsDealbreaker: z.boolean().optional(),
    verifiedOnly: z.boolean().optional(),
  })
  .strict();

export const datingLikeSchema = z
  .object({
    receiverProfileId: z.string().uuid(),
    targetType: z.enum(likeTargets),
    targetId: z.string().trim().min(1).max(64).nullable().optional(),
    comment: z.string().trim().max(DATING_COMMENT_MAX).nullable().optional(),
  })
  .strict();

export const datingPassSchema = z.object({ profileId: z.string().uuid() }).strict();

export const datingUnmatchSchema = z
  .object({ reason: z.string().trim().max(500).nullable().optional() })
  .strict();

export const datingMessageSchema = z
  .object({
    body: z.string().trim().max(DATING_MESSAGE_MAX).nullable().optional(),
    attachment: z
      .object({
        objectKey: z.string().trim().min(1).max(300),
        contentType: z.enum(imageTypes),
        byteSize: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
      })
      .optional(),
  })
  .strict();

export const datingChatPresignSchema = z
  .object({
    conversationId: z.string().uuid(),
    contentType: z.enum(imageTypes),
    fileSizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();

export const datingBlockSchema = z.object({ profileId: z.string().uuid() }).strict();

export const datingReportSchema = z
  .object({
    profileId: z.string().uuid(),
    reasonCategory: z.enum(reportCategories),
    details: z.string().trim().max(2000).nullable().optional(),
    evidencePhotoKeys: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
  })
  .strict();

export const datingReportResolveSchema = z
  .object({
    action: z.enum(['DISMISS', 'WARN', 'SUSPEND', 'BAN', 'NOTE']).optional(),
    status: z.enum(reportStatuses).optional(),
    resolutionNotes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const datingVerificationDecisionSchema = z
  .object({ status: z.enum(['VERIFIED', 'REJECTED']) })
  .strict();

const errors = {
  400: swaggerErrorEnvelope('Validation error'),
  401: swaggerErrorEnvelope('Unauthorized'),
  403: swaggerErrorEnvelope('Forbidden'),
  404: swaggerErrorEnvelope('Not found'),
  409: swaggerErrorEnvelope('Conflict'),
  429: swaggerErrorEnvelope('Too many requests'),
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};

const pageQuery = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    status: { type: 'string', enum: Object.values(DatingReportStatus) },
    reasonCategory: { type: 'string', enum: Object.values(DatingReportCategory) },
  },
};

function datingRoute(
  summary: string,
  extras: Partial<FastifySchema> = {},
  message = 'OK',
): FastifySchema {
  return {
    tags: ['420 Dating'],
    summary,
    description:
      'Authenticated Ripskis member. Blocked creator accounts are rejected. Banned dating profiles are rejected on mutating dating actions. birthDate and exact coordinates are never returned. Single-process SSE does not cross API instances.',
    security: [{ bearerAuth: [] }],
    response: {
      200: swaggerSuccessEnvelope(
        { type: 'object', additionalProperties: true },
        message,
      ),
      201: swaggerSuccessEnvelope(
        { type: 'object', additionalProperties: true },
        message,
      ),
      ...errors,
    },
    ...extras,
  };
}

export const getMyDatingProfileSwaggerSchema = datingRoute('Get my dating profile');
export const onboardDatingSwaggerSchema = datingRoute('Complete dating onboarding', {
  body: { type: 'object', additionalProperties: true },
});
export const patchMyDatingProfileSwaggerSchema = datingRoute('Update my dating profile', {
  body: { type: 'object', additionalProperties: true },
});
export const patchDatingStatusSwaggerSchema = datingRoute(
  'Pause or activate my dating profile',
  {
    body: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] } },
    },
  },
);
export const deleteMyDatingProfileSwaggerSchema = datingRoute('Delete my dating profile');
export const getDatingProfileSwaggerSchema = datingRoute(
  'View a dating profile narrative',
  {
    params: idParams,
  },
);
export const presignDatingPhotoSwaggerSchema = datingRoute(
  'Presign a dating photo upload',
  {
    body: { type: 'object', additionalProperties: true },
  },
);
export const confirmDatingPhotoSwaggerSchema = datingRoute(
  'Confirm a dating photo upload',
  {
    body: { type: 'object', additionalProperties: true },
  },
);
export const reorderDatingPhotosSwaggerSchema = datingRoute('Reorder dating photos', {
  body: { type: 'object', additionalProperties: true },
});
export const primaryDatingPhotoSwaggerSchema = datingRoute(
  'Set the primary dating photo',
  {
    params: idParams,
  },
);
export const deleteDatingPhotoSwaggerSchema = datingRoute('Delete a dating photo', {
  params: idParams,
});
export const getDatingPreferencesSwaggerSchema = datingRoute('Get dating preferences');
export const patchDatingPreferencesSwaggerSchema = datingRoute(
  'Update dating preferences',
  {
    body: { type: 'object', additionalProperties: true },
  },
);
export const discoverDatingSwaggerSchema = datingRoute('Discover dating profiles', {
  querystring: pageQuery,
});
export const passDatingSwaggerSchema = datingRoute('Pass a dating profile', {
  body: {
    type: 'object',
    required: ['profileId'],
    properties: { profileId: { type: 'string' } },
  },
});
export const likeDatingSwaggerSchema = datingRoute('Send a contextual like', {
  body: { type: 'object', additionalProperties: true },
});
export const receivedLikesSwaggerSchema = datingRoute('List likes you received', {
  querystring: pageQuery,
});
export const sentLikesSwaggerSchema = datingRoute('List likes you sent', {
  querystring: pageQuery,
});
export const listMatchesSwaggerSchema = datingRoute('List dating matches');
export const getMatchSwaggerSchema = datingRoute('Get a dating match', {
  params: idParams,
});
export const unmatchSwaggerSchema = datingRoute('Unmatch a dating connection', {
  params: idParams,
  body: { type: 'object', additionalProperties: true },
});
export const listDatingConversationsSwaggerSchema = datingRoute(
  'List dating conversations',
);
export const listDatingMessagesSwaggerSchema = datingRoute('List dating messages', {
  params: idParams,
  querystring: pageQuery,
});
export const sendDatingMessageSwaggerSchema = datingRoute('Send a dating message', {
  params: idParams,
  body: { type: 'object', additionalProperties: true },
});
export const readDatingConversationSwaggerSchema = datingRoute(
  'Mark a dating conversation read',
  {
    params: idParams,
  },
);
export const presignDatingChatSwaggerSchema = datingRoute('Presign a dating chat image', {
  body: { type: 'object', additionalProperties: true },
});
export const datingStreamSwaggerSchema: FastifySchema = {
  tags: ['420 Dating'],
  summary: 'Server-sent events for dating messages, reads, matches, and likes',
  description:
    'text/event-stream. Events: message, read, match, like_received. Keepalive comments are `: ping`. Retry hint is 3000ms. Fanout is in-memory for one API process and does not reach clients connected to another instance.',
  security: [{ bearerAuth: [] }],
  response: {
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};
export const blockDatingSwaggerSchema = datingRoute('Block a dating profile', {
  body: {
    type: 'object',
    required: ['profileId'],
    properties: { profileId: { type: 'string' } },
  },
});
export const unblockDatingSwaggerSchema = datingRoute('Remove a dating block', {
  params: idParams,
});
export const listBlocksSwaggerSchema = datingRoute('List dating blocks');
export const reportDatingSwaggerSchema = datingRoute('Report a dating profile', {
  body: { type: 'object', additionalProperties: true },
});
export const listDatingNotificationsSwaggerSchema = datingRoute(
  'List dating notifications',
  {
    querystring: pageQuery,
  },
);
export const readDatingNotificationSwaggerSchema = datingRoute(
  'Mark a dating notification read',
  {
    params: idParams,
  },
);
export const readAllDatingNotificationsSwaggerSchema = datingRoute(
  'Mark all dating notifications read',
);
export const presignDatingVerificationSwaggerSchema = datingRoute(
  'Presign a verification selfie',
  {
    body: { type: 'object', additionalProperties: true },
  },
);
export const confirmDatingVerificationSwaggerSchema = datingRoute(
  'Submit a verification selfie',
  {
    body: { type: 'object', additionalProperties: true },
  },
);
export const adminDatingReportsSwaggerSchema = datingRoute(
  'List dating reports for moderators',
  {
    querystring: pageQuery,
  },
);
export const adminDatingReportSwaggerSchema = datingRoute('Inspect a dating report', {
  params: idParams,
});
export const adminResolveDatingReportSwaggerSchema = datingRoute(
  'Resolve a dating report',
  {
    params: idParams,
    body: { type: 'object', additionalProperties: true },
  },
);
export const adminBanDatingProfileSwaggerSchema = datingRoute('Ban a dating profile', {
  params: idParams,
});
export const adminVerificationSwaggerSchema = datingRoute(
  'Decide a dating verification selfie',
  {
    params: idParams,
    body: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['VERIFIED', 'REJECTED'] } },
    },
  },
);
