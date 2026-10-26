import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { isValidIanaTimeZone } from '../services/contest-schedule.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const multiplier = z.number().finite().min(0).max(100);

export const updateCounterSchema = z
  .object({
    startingEstimate: z
      .string()
      .regex(/^\d{1,18}$/, 'startingEstimate must be a whole number up to 18 digits')
      .optional(),
    baseRatePerSecond: z.number().finite().min(0).max(1_000_000).optional(),
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
    timezone: z
      .string()
      .trim()
      .refine((value) => isValidIanaTimeZone(value), 'timezone must be a valid IANA name')
      .optional(),
    provisional: z.boolean().optional(),
    paused: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
    subtitle: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateCounterInput = z.infer<typeof updateCounterSchema>;

const snapshotSchema = {
  type: 'object',
  properties: {
    hits: { type: 'string' },
    remainderMicros: { type: 'integer' },
    asOf: { type: 'string' },
    ratePerSecond: { type: 'number' },
    paused: { type: 'boolean' },
    provisional: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    timezone: { type: 'string' },
  },
};

const configSchema = {
  type: 'object',
  properties: {
    startingEstimate: { type: 'string' },
    remainderMicros: { type: 'integer' },
    anchorAt: { type: 'string' },
    paused: { type: 'boolean' },
    frozenHits: { type: 'string', nullable: true },
    baseRatePerSecond: { type: 'number' },
    weekdayMultipliers: { type: 'array', items: { type: 'number' } },
    fridayBoost: { type: 'number' },
    weekendBoost: { type: 'number' },
    april20Multiplier: { type: 'number' },
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
      { type: 'object', properties: { config: configSchema, snapshot: snapshotSchema } },
      'Counter configuration retrieved',
    ),
    401: errors[401],
    403: errors[403],
    500: errors[500],
  },
};

export const updateCounterSwaggerSchema: FastifySchema = {
  tags: ['Counter'],
  summary: 'Update counter configuration',
  description:
    'ADMIN only. Invalid bodies are rejected and the stored row is left unchanged. A new startingEstimate resets the displayed count. Rate, multiplier, and timezone changes keep the current count and apply going forward. paused freezes or resumes the clock.',
  security: [{ bearerAuth: [] }],
  body: { type: 'object', additionalProperties: true },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'object', properties: { config: configSchema, snapshot: snapshotSchema } },
      'Counter configuration updated',
    ),
    ...errors,
  },
};
