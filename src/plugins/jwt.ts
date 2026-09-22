import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { SYSTEM_CONSTANTS } from '../config/constants.js';
import { errorResponse } from '../utils/response.js';

const jwtPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: SYSTEM_CONSTANTS.JWT_EXPIRES_IN,
    },
  });

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Authentication required or token invalid';
        reply.status(401).send(errorResponse(`Unauthorized: ${message}`));
      }
    },
  );
};

export const jwtPlugin = fp(jwtPluginAsync, {
  name: 'jwt-plugin',
});
