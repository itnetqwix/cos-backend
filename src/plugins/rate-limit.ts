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
