import { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { RATE_LIMIT_DEFAULTS } from '../config/constants.js';

/**
 * Route-scoped rate limit (M12). `global: false` so health, reads, and
 * unrelated writes are not limited. Exceeded requests throw an Error with
 * `statusCode` 429; `globalErrorHandler` maps that to the frozen envelope
 * and does not attach a stack (stacks are only added for HTTP 500).
 *
 * Limits live in `RATE_LIMIT_DEFAULTS` and are engineering defaults.
 */
const rateLimitPluginAsync: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    global: false,
    hook: 'onRequest',
    errorResponseBuilder: (_request, context) => {
      const error = new Error('Too many requests') as FastifyError;
      error.statusCode = context.statusCode;
      return error;
    },
  });
};

export const rateLimitPlugin = fp(rateLimitPluginAsync, {
  name: 'rate-limit-plugin',
});

/** Per-route ceiling for login and for each register route. */
export const authCredentialRateLimit = {
  max: RATE_LIMIT_DEFAULTS.AUTH_MAX,
  timeWindow: RATE_LIMIT_DEFAULTS.AUTH_TIME_WINDOW_MS,
} as const;

/** Per-route ceiling for community rating POST (M12-P01-T02). */
export const ratingRateLimit = {
  max: RATE_LIMIT_DEFAULTS.RATING_MAX,
  timeWindow: RATE_LIMIT_DEFAULTS.RATING_TIME_WINDOW_MS,
} as const;

/** Per-route ceiling for Planet Zooteer abuse reports. Process-local, not shared across API instances. */
export const zooteerReportRateLimit = {
  max: 5,
  timeWindow: 15 * 60 * 1000,
} as const;
export const zooteerRelayRateLimit = {
  max: 30,
  timeWindow: 10_000,
} as const;

export const passwordResetRateLimit = {
  max: 5,
  timeWindow: 15 * 60 * 1000,
} as const;

/** Coarse IP ceilings. Per-profile caps are also enforced in the dating services. Process-local. */
export const datingLikeRateLimit = { max: 100, timeWindow: 24 * 60 * 60 * 1000 } as const;
export const datingMessageRateLimit = { max: 30, timeWindow: 60 * 1000 } as const;
export const datingPhotoPresignRateLimit = {
  max: 10,
  timeWindow: 60 * 60 * 1000,
} as const;
export const datingReportRateLimit = { max: 5, timeWindow: 24 * 60 * 60 * 1000 } as const;

/**
 * New SSE handshakes only. One open stream is one request.
 * Keyed by user id after auth (`preHandler`), so it does not share the
 * like, message, or presign buckets and does not cover `/dating/profile/me`.
 */
export const datingStreamRateLimit = {
  max: 6,
  timeWindow: 60 * 1000,
  hook: 'preHandler' as const,
  keyGenerator: (request: { user?: { id?: string }; ip: string }) =>
    request.user?.id ?? request.ip,
};
