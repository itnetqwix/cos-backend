import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config/env.js';
import { corsOriginDecision } from '../config/cors-policy.js';

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
] as const;

export function corsPluginOptions(allowedOrigins: readonly string[]) {
  return {
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow: string | false) => void,
    ) {
      callback(null, corsOriginDecision(origin, allowedOrigins));
    },
    credentials: true,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
  };
}

const corsPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(cors, corsPluginOptions(env.CORS_ORIGINS.split(',')));
};

export const corsPlugin = fp(corsPluginAsync, {
  name: 'cors-plugin',
});
