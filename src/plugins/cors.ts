import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

const corsPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // CORS_ORIGIN is not an env.ts key and is not read here (M01-P01-T02).
  // Allowed-origin list: NOT SPECIFIED — current behavior is hardcoded origin '*'.
  await fastify.register(cors, {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });
};

export const corsPlugin = fp(corsPluginAsync, {
  name: 'cors-plugin',
});
