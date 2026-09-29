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
import { S3StorageAdapter } from './services/s3-storage.adapter.js';
import { LocalDemoStorageAdapter } from './services/local-demo-storage.adapter.js';
import { getStorageService, setStorageService } from './services/storage.service.js';

/**
 * Fastify Application Factory.
 * Configures all security plugins, OpenAPI documentation, master routes, and global error handling.
 *
 * Frozen plugin registration order (M01-P01-T03) in `buildApp()`:
 * 1. `setErrorHandler(globalErrorHandler)` (not a plugin)
 * 2. `corsPlugin`
 * 3. `helmetPlugin`
 * 4. `prismaPlugin`
 * 5. `jwtPlugin`
 * 6. `swaggerPlugin`
 * 7. `routes` at `SYSTEM_CONSTANTS.API_PREFIX` (`/api/v1`)
 *
 * A required order is NOT SPECIFIED in `/docs/source` or `/docs/knowledge`.
 * `prismaPlugin` and `jwtPlugin` do not depend on each other (no `fp()`
 * `dependencies`); relative order is NOT SPECIFIED and is frozen as currently
 * implemented (prisma then jwt), not swapped to match the task name list.
 *
 * Library constraint (not a business rule): swagger is registered before routes
 * so `@fastify/swagger` can collect route schemas. Swagger UI is `/docs`.
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

  // 2. Register core infrastructure and security plugins (order frozen M01-P01-T03)
  await app.register(corsPlugin);
  await app.register(helmetPlugin);
  await app.register(prismaPlugin);
  await app.register(jwtPlugin);
  await app.register(swaggerPlugin);

  // 3. Storage adapter. Tests inject a fake StorageService before buildApp.
  // Default provider is s3. Missing AWS config does not fail boot and does
  // not fall back to disk. local-demo is selected only by STORAGE_PROVIDER.
  let storageAlreadySet = false;
  try {
    getStorageService();
    storageAlreadySet = true;
  } catch {
    storageAlreadySet = false;
  }
  if (!storageAlreadySet && env.STORAGE_PROVIDER === 'local-demo') {
    setStorageService(LocalDemoStorageAdapter.fromEnv());
  } else if (
    !storageAlreadySet &&
    env.STORAGE_PROVIDER === 's3' &&
    env.AWS_REGION &&
    env.AWS_S3_BUCKET
  ) {
    setStorageService(S3StorageAdapter.fromEnv());
  }

  // 4. Register master API routes under /api/v1 prefix (after swagger)
  await app.register(routes, { prefix: SYSTEM_CONSTANTS.API_PREFIX });

  return app;
}
