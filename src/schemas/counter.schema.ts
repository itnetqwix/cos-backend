import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { isValidIanaTimeZone } from '../services/contest-schedule.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const multiplier = z.number().finite().min(0).max(100);
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const specialDateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    multiplier,
    mode: z.enum(['override', 'stack']),
    recurring: z.boolean(),
    startDate: dayKey.nullish().transform((value) => value ?? null),
    endDate: dayKey.nullish().transform((value) => value ?? null),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
  .refine(
    (value) => value.recurring || (value.startDate !== null && value.endDate !== null),
    {
      message: 'A one-off date needs a start and an end',
    },
  );

export const updateCounterSchema = z
  .object({
    startingEstimate: z
      .string()
      .regex(/^\d{1,18}$/, 'startingEstimate must be a whole number up to 18 digits')
      .optional(),
    confirmReset: z.boolean().optional(),
    estimatedUsers: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    averageUsesPerUserPerDay: z.number().finite().positive().max(1000).optional(),
    manualRatePerSecond: z
      .number()
      .finite()
      .min(0)
      .max(1_000_000_000)
      .nullable()
      .optional(),
    weekdayMultipliers: z
      .tuple([
        multiplier,
        multiplier,
        multiplier,
        multiplier,
        multiplier,
        multiplier,
        multiplier,
      ])
      .optional(),
    fridayBoost: multiplier.optional(),
    weekendBoost: multiplier.optional(),
    april20Multiplier: multiplier.optional(),
    specialMonth: z.number().int().min(1).max(12).optional(),
    specialDay: z.number().int().min(1).max(31).optional(),
    specialMode: z.enum(['override', 'stack']).optional(),
    specialDates: z.array(specialDateSchema).max(30).optional(),
    effectiveAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    timezone: z
      .string()
      .trim()
      .refine((value) => isValidIanaTimeZone(value), 'timezone must be a valid IANA name')
      .optional(),
    provisional: z.boolean().optional(),
    paused: z.boolean().optional(),
    enabled: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
    subtitle: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).filter((key) => key !== 'confirmReset').length > 0,
    {
      message: 'At least one field is required',
    },
  )
  .refine(
    (value) => value.startingEstimate === undefined || value.confirmReset === true,
    {
      message: 'Confirm the count reset before changing the starting estimate',
    },
  );

export type UpdateCounterInput = z.infer<typeof updateCounterSchema>;

const snapshotSchema = {
  type: 'object',
  properties: {
    hits: { type: 'string' },
    remainderMicros: { type: 'integer' },
    asOf: { type: 'string' },
    ratePerSecond: { type: 'number' },
    effectiveDailyEstimate: { type: 'string' },
    growthToday: { type: 'string' },
    nextChangeAt: { type: 'string', nullable: true },
    nextChangeLabel: { type: 'string', nullable: true },
    estimateNote: { type: 'string' },
    paused: { type: 'boolean' },
    provisional: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    timezone: { type: 'string' },
  },
};

const configSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    startingEstimate: { type: 'string' },
    remainderMicros: { type: 'integer' },
    anchorAt: { type: 'string' },
    paused: { type: 'boolean' },
    enabled: { type: 'boolean' },
    frozenHits: { type: 'string', nullable: true },
    estimatedUsers: { type: 'string' },
    averageUsesPerUserPerDay: { type: 'number' },
    manualRatePerSecond: { type: 'number', nullable: true },
    baseRatePerSecond: { type: 'number' },
    weekdayMultipliers: { type: 'array', items: { type: 'number' } },
    fridayBoost: { type: 'number' },
    weekendBoost: { type: 'number' },
    april20Multiplier: { type: 'number' },
    specialMonth: { type: 'integer' },
    specialDay: { type: 'integer' },
    specialMode: { type: 'string' },
    specialDates: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    pending: { type: 'object', nullable: true, additionalProperties: true },
    timezone: { type: 'string' },
    provisional: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedById: { type: 'string', nullable: true },
  },
};

const errors = {
  400: swaggerErrorEnvelope('Validation error'),
  401: swaggerErrorEnvelope('Unauthorized'),
  403: swaggerErrorEnvelope('Forbidden'),
  500: swaggerErrorEnvelope('Internal server error'),
};

export const getCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Current estimated hits',
  description:
    'Public snapshot. The count is calculated from the stored baseline. Provisional defaults apply until an admin replaces them. No WebSocket route; use GET /counter/stream for server-sent events.',
  response: {
    200: swaggerSuccessEnvelope(snapshotSchema, 'Counter snapshot retrieved'),
    500: errors[500],
  },
};

export const counterStreamSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Server-sent events for counter snapshots',
  description:
    'Public text/event-stream. First frame includes retry: 3000 and event snapshot. Later frames are event snapshot. No WebSocket dependency. Fanout is in-memory for one API process.',
  response: {
    500: errors[500],
  },
};

export const getAdminCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Counter configuration and current snapshot',
  description: 'ADMIN only. Returns the stored baseline plus the calculated snapshot.',
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        additionalProperties: true,
        properties: { config: configSchema, snapshot: snapshotSchema },
      },
      'Counter configuration retrieved',
    ),
    401: errors[401],
    403: errors[403],
    500: errors[500],
  },
};

export const previewCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Preview a counter change without saving',
  description:
    'ADMIN only. Returns the rates the patch would produce. It does not write.',
  security: [{ bearerAuth: [] }],
  body: { type: 'object', additionalProperties: true },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object', additionalProperties: true },
      'Counter preview',
    ),
    ...errors,
  },
};

export const exportCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Export the counter calculation summary',
  description: 'ADMIN only. JSON summary of the current model. It does not write.',
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object', additionalProperties: true },
      'Counter summary exported',
    ),
    401: errors[401],
    403: errors[403],
  },
};

export const updateCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Update counter configuration',
  description:
    'ADMIN only. Invalid bodies are rejected and the stored row is left unchanged. startingEstimate resets the displayed count only when confirmReset is true. Rate changes keep the current count. A future effectiveAt schedules the rate change instead of applying it now. April 20 is month 4 day 20 unless the admin changes the special date. Default special mode is override, not stack.',
  security: [{ bearerAuth: [] }],
  body: { type: 'object', additionalProperties: true },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        additionalProperties: true,
        properties: { config: configSchema, snapshot: snapshotSchema },
      },
      'Counter configuration updated',
    ),
    ...errors,
  },
};
