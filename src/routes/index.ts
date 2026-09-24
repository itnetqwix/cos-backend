import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { AuthController } from '../controllers/auth.controller.js';
import { ContestController } from '../controllers/contest.controller.js';
import { OrganizationController } from '../controllers/organization.controller.js';
import { UserController } from '../controllers/user.controller.js';
import { authorizeRoles } from '../middleware/auth.middleware.js';
import {
  registerCreatorSwaggerSchema,
  registerBrandSwaggerSchema,
  loginSwaggerSchema,
  getMeSwaggerSchema,
} from '../schemas/auth.schema.js';
import {
  createContestSwaggerSchema,
  getContestSwaggerSchema,
  listContestsSwaggerSchema,
  updateContestSwaggerSchema,
} from '../schemas/contest.schema.js';
import {
  getOrganizationBrandingSwaggerSchema,
  updateOrganizationBrandingSwaggerSchema,
} from '../schemas/organization.schema.js';
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
  // 1. Base & System Operational Endpoints (frozen M01-P01-T04)
  // Public (no authenticate). Envelope via sendSuccess (M01-P01-T01).
  // Health does not probe Prisma / DATABASE_URL — DB readiness is NOT SPECIFIED.
  // Root `data.name` is SYSTEM_CONSTANTS.APP_NAME, not the npm package name.
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

  // GET /auth/me is private: `onRequest: [fastify.authenticate]` (M02-P01-T04).
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
  // M03-P01-T02: SUPER_ADMIN only. BRAND_ADMIN org-scoped listing is
  // NOT SPECIFIED in source/knowledge and is not allowed here (no
  // invented tenant user-list). Self-profile remains GET /auth/me.
  // -------------------------------------------------------------

  fastify.get(
    '/users',
    {
      schema: listUsersSwaggerSchema,
      onRequest: [fastify.authenticate, authorizeRoles(Role.SUPER_ADMIN)],
    },
    UserController.listUsers,
  );

  fastify.get(
    '/users/:id',
    {
      schema: getUserByIdSwaggerSchema,
      onRequest: [fastify.authenticate, authorizeRoles(Role.SUPER_ADMIN)],
    },
    UserController.getUserById,
  );

  // -------------------------------------------------------------
  // 4. Organization branding (/api/v1/organizations)
  // M04-P02. GET is public (no authenticate). PUT is
  // BRAND_ADMIN (own organizationId only, enforced in OrganizationService)
  // or SUPER_ADMIN (any organization).
  // Suspension routes are not registered here (M10).
  // -------------------------------------------------------------

  fastify.get(
    '/organizations/:slug/branding',
    { schema: getOrganizationBrandingSwaggerSchema },
    OrganizationController.getBrandingBySlug,
  );

  fastify.put(
    '/organizations/:id/branding',
    {
      schema: updateOrganizationBrandingSwaggerSchema,
      onRequest: [
        fastify.authenticate,
        authorizeRoles(Role.BRAND_ADMIN, Role.SUPER_ADMIN),
      ],
    },
    OrganizationController.updateBranding,
  );

  // -------------------------------------------------------------
  // 5. Contests (/api/v1/contests)
  // M05. BRAND_ADMIN is scoped to JWT organizationId in ContestService.
  // SUPER_ADMIN is cross-tenant. CREATOR and VIEWER are not granted:
  // their contest visibility is NOT SPECIFIED. No submission routes (M06).
  // -------------------------------------------------------------

  const contestGuards = [
    fastify.authenticate,
    authorizeRoles(Role.BRAND_ADMIN, Role.SUPER_ADMIN),
  ];

  fastify.get(
    '/contests',
    {
      schema: listContestsSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.list,
  );

  fastify.post(
    '/contests',
    {
      schema: createContestSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.create,
  );

  fastify.get(
    '/contests/:id',
    {
      schema: getContestSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.getById,
  );

  fastify.patch(
    '/contests/:id',
    {
      schema: updateContestSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.update,
  );
};
