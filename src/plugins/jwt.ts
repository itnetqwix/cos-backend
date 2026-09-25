import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { SYSTEM_CONSTANTS } from '../config/constants.js';
import { authenticate } from '../middleware/auth.middleware.js';

/**
 * Registers `@fastify/jwt` and decorates `fastify.authenticate`.
 *
 * M03-P01-T01: the decorate target is the canonical `authenticate` hook from
 * `auth.middleware.ts` (single implementation). JWT sign options still use
 * `env.JWT_SECRET` and `SYSTEM_CONSTANTS.JWT_EXPIRES_IN` (`7d`).
 *
 * M12-P01-T03 review: expiry stays `7d` (not an env var). Claims stay
 * `{ id, email, role, organizationId }`. Secret stays `env.JWT_SECRET`.
 * When `JWT_SECRET` is omitted, `env.ts` still applies its M01 fallback.
 * Minimum length, rotation, and failing boot without a secret are
 * NOT SPECIFIED, so this review does not change that fallback.
 */
const jwtPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: SYSTEM_CONSTANTS.JWT_EXPIRES_IN,
    },
  });

  fastify.decorate('authenticate', authenticate);
};

export const jwtPlugin = fp(jwtPluginAsync, {
  name: 'jwt-plugin',
});
