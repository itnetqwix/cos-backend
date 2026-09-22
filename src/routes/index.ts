import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AuthController } from '../controllers/auth.controller.js';
import { UserController } from '../controllers/user.controller.js';
import {
  registerCreatorSwaggerSchema,
  registerBrandSwaggerSchema,
  loginSwaggerSchema,
  getMeSwaggerSchema,
} from '../schemas/auth.schema.js';
import {
  listUsersSwaggerSchema,
  getUserByIdSwaggerSchema,
  healthSwaggerSchema,
  rootSwaggerSchema,
} from '../schemas/user.schema.js';
import { sendSuccess } from '../utils/response.js';
import { SYSTEM_CONSTANTS, HTTP_STATUS } from '../config/constants.js';

export const routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // -------------------------------------------------------------
  // 1. Base & System Operational Endpoints
  // -------------------------------------------------------------

  fastify.get('/health', { schema: healthSwaggerSchema }, async (_request, reply) => {
    return sendSuccess(
      reply,
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      },
      'Contest Operating System API is healthy',
      HTTP_STATUS.OK,
    );
  });

  fastify.get('/', { schema: rootSwaggerSchema }, async (_request, reply) => {
    return sendSuccess(
      reply,
      {
        version: SYSTEM_CONSTANTS.API_VERSION,
        name: SYSTEM_CONSTANTS.APP_NAME,
      },
      'Hello World from Contest Operating System API!',
      HTTP_STATUS.OK,
    );
  });

  // -------------------------------------------------------------
  // 2. Authentication Endpoints (/api/v1/auth)
  // -------------------------------------------------------------

  fastify.post(
    '/auth/register/creator',
    { schema: registerCreatorSwaggerSchema },
    AuthController.registerCreator,
  );

  fastify.post(
    '/auth/register/brand',
    { schema: registerBrandSwaggerSchema },
    AuthController.registerBrand,
  );

  fastify.post('/auth/login', { schema: loginSwaggerSchema }, AuthController.login);

  fastify.get(
    '/auth/me',
    {
      schema: getMeSwaggerSchema,
      onRequest: [fastify.authenticate],
    },
    AuthController.getMe,
  );

  // -------------------------------------------------------------
  // 3. User Management Endpoints (/api/v1/users)
  // -------------------------------------------------------------

  fastify.get(
    '/users',
    {
      schema: listUsersSwaggerSchema,
      onRequest: [fastify.authenticate],
    },
    UserController.listUsers,
  );

  fastify.get(
    '/users/:id',
    {
      schema: getUserByIdSwaggerSchema,
      onRequest: [fastify.authenticate],
    },
    UserController.getUserById,
  );
};
