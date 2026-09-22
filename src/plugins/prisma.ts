import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../config/database.js';

const prismaPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export const prismaPlugin = fp(prismaPluginAsync, {
  name: 'prisma-plugin',
});
