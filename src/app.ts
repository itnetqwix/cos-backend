import Fastify, { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { SYSTEM_CONSTANTS } from './config/constants.js';
import { corsPlugin } from './plugins/cors.js';
import { helmetPlugin } from './plugins/helmet.js';
import { jwtPlugin } from './plugins/jwt.js';
import { prismaPlugin } from './plugins/prisma.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { globalErrorHandler } from './middleware/error.middleware.js';
import { routes } from './routes/index.js';

/**
 * Fastify Application Factory.
 * Configures all security plugins, OpenAPI documentation, master routes, and global error handling.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

  const app = Fastify({
    logger: isTest
      ? false
      : { level: env.LOG_LEVEL || (env.NODE_ENV === 'development' ? 'info' : 'warn') },
    ajv: {
      customOptions: {
        strict: false,
        keywords: ['example'],
      },
    },
  });

  // 1. Set global error handling middleware
  app.setErrorHandler(globalErrorHandler);

  // 2. Register core infrastructure and security plugins
  await app.register(corsPlugin);
  await app.register(helmetPlugin);
  await app.register(prismaPlugin);
  await app.register(jwtPlugin);
  await app.register(swaggerPlugin);

  // 3. Register master API routes under /api/v1 prefix
  await app.register(routes, { prefix: SYSTEM_CONSTANTS.API_PREFIX });

  return app;
}
