import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

const helmetPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
};

export const helmetPlugin = fp(helmetPluginAsync, {
  name: 'helmet-plugin',
});
