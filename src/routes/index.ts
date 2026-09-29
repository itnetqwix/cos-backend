import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { AuthController } from '../controllers/auth.controller.js';
import { ContestController } from '../controllers/contest.controller.js';
import { ModerationController } from '../controllers/moderation.controller.js';
import { SubmissionController } from '../controllers/submission.controller.js';
import { UserController } from '../controllers/user.controller.js';
import { authenticateOptional, authorizeRoles } from '../middleware/auth.middleware.js';
import { JudgingController } from '../controllers/judging.controller.js';
import { LeaderboardController } from '../controllers/leaderboard.controller.js';
import {
  judgingQueueSwaggerSchema,
  rateSubmissionSwaggerSchema,
} from '../schemas/judging.schema.js';
import { getLeaderboardSwaggerSchema } from '../schemas/leaderboard.schema.js';
import {
  registerCreatorSwaggerSchema,
  loginSwaggerSchema,
  getMeSwaggerSchema,
} from '../schemas/auth.schema.js';
import {
  createContestSwaggerSchema,
  getContestSwaggerSchema,
  listContestsSwaggerSchema,
  listDeploymentActiveContestsSwaggerSchema,
  updateContestSwaggerSchema,
} from '../schemas/contest.schema.js';
import {
  auditLogsSwaggerSchema,
  approveSubmissionSwaggerSchema,
  moderationQueueSwaggerSchema,
  rejectSubmissionSwaggerSchema,
} from '../schemas/moderation.schema.js';
import {
  completeSubmissionSwaggerSchema,
  getSubmissionSwaggerSchema,
  listMySubmissionsSwaggerSchema,
  presignSubmissionSwaggerSchema,
} from '../schemas/submission.schema.js';
import {
  listUsersSwaggerSchema,
  getUserByIdSwaggerSchema,
  healthSwaggerSchema,
  rootSwaggerSchema,
} from '../schemas/user.schema.js';
import { sendSuccess } from '../utils/response.js';
import { SYSTEM_CONSTANTS, HTTP_STATUS } from '../config/constants.js';
import {
  authCredentialRateLimit,
  rateLimitPlugin,
  ratingRateLimit,
} from '../plugins/rate-limit.js';

export const routes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // M12 rate limits. Registered here so the frozen M01 plugin order in
  // `buildApp()` (cors → helmet → prisma → jwt → swagger) stays unchanged.
  // `global: false`: only routes that set `config.rateLimit` are limited.
  await fastify.register(rateLimitPlugin);

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

  // Admin is provisioned. There is no public admin registration.
  fastify.post(
    '/auth/register/creator',
    {
      schema: registerCreatorSwaggerSchema,
      config: { rateLimit: authCredentialRateLimit },
    },
    AuthController.registerCreator,
  );

  fastify.post(
    '/auth/login',
    {
      schema: loginSwaggerSchema,
      config: { rateLimit: authCredentialRateLimit },
    },
    AuthController.login,
  );

  // GET /auth/me is private: `onRequest: [fastify.authenticate]` (M02-P01-T04).
  fastify.get(
    '/auth/me',
    {
      schema: getMeSwaggerSchema,
      onRequest: [fastify.authenticate],
    },
    AuthController.getMe,
  );

  // User listing is ADMIN only. Self-profile remains GET /auth/me.
  // -------------------------------------------------------------

  fastify.get(
    '/users',
    {
      schema: listUsersSwaggerSchema,
      onRequest: [fastify.authenticate, authorizeRoles(Role.ADMIN)],
    },
    UserController.listUsers,
  );

  fastify.get(
    '/users/:id',
    {
      schema: getUserByIdSwaggerSchema,
      onRequest: [fastify.authenticate, authorizeRoles(Role.ADMIN)],
    },
    UserController.getUserById,
  );

  // -------------------------------------------------------------
  // Contests (/api/v1/contests)
  // ADMIN manages contests. CREATOR is not granted these routes.
  // -------------------------------------------------------------

  const contestGuards = [fastify.authenticate, authorizeRoles(Role.ADMIN)];

  fastify.get(
    '/contests',
    {
      schema: listContestsSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.list,
  );

  // Public ACTIVE contests for this deployment only. No organization,
  // brand, or domain parameter. Registered before /contests/:id.
  fastify.get(
    '/contests/active',
    { schema: listDeploymentActiveContestsSwaggerSchema },
    ContestController.listDeploymentActive,
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

  // -------------------------------------------------------------
  // 6. Submissions (/api/v1/submissions)
  // M06. CREATOR only. Presign + complete (no binary through Fastify).
  // The legacy binary ingest path is intentionally not registered.
  // Register /me before /:id. Moderation routes are section 7.
  // -------------------------------------------------------------

  const creatorGuards = [fastify.authenticate, authorizeRoles(Role.CREATOR)];

  fastify.post(
    '/submissions/presign',
    {
      schema: presignSubmissionSwaggerSchema,
      onRequest: creatorGuards,
    },
    SubmissionController.presign,
  );

  fastify.post(
    '/submissions/complete',
    {
      schema: completeSubmissionSwaggerSchema,
      onRequest: creatorGuards,
    },
    SubmissionController.complete,
  );

  fastify.get(
    '/submissions/me',
    {
      schema: listMySubmissionsSwaggerSchema,
      onRequest: creatorGuards,
    },
    SubmissionController.listMine,
  );

  fastify.get(
    '/submissions/:id',
    {
      schema: getSubmissionSwaggerSchema,
      onRequest: creatorGuards,
    },
    SubmissionController.getById,
  );

  // -------------------------------------------------------------
  // 7. Moderation (/api/v1/admin/...)
  // ADMIN only. CREATOR is not granted.
  // No flag, bulk, warning, or suspension routes (not in the M07 API list).
  // Judging routes are section 8. No leaderboard route (M09).
  // -------------------------------------------------------------

  const moderatorGuards = [fastify.authenticate, authorizeRoles(Role.ADMIN)];

  fastify.get(
    '/admin/moderation/queue',
    {
      schema: moderationQueueSwaggerSchema,
      onRequest: moderatorGuards,
    },
    ModerationController.queue,
  );

  fastify.get(
    '/admin/moderation/audit-logs',
    {
      schema: auditLogsSwaggerSchema,
      onRequest: moderatorGuards,
    },
    ModerationController.auditLogs,
  );

  fastify.post(
    '/admin/submissions/:id/approve',
    {
      schema: approveSubmissionSwaggerSchema,
      onRequest: moderatorGuards,
    },
    ModerationController.approve,
  );

  fastify.post(
    '/admin/submissions/:id/reject',
    {
      schema: rejectSubmissionSwaggerSchema,
      onRequest: moderatorGuards,
    },
    ModerationController.reject,
  );

  // -------------------------------------------------------------
  // 8. Judging (/api/v1/contests/:id/queue and .../rate)
  // M08. Queue is public. Rate auth is optional (anonymous guest).
  // Voting window is ACTIVE or JUDGING. No leaderboard route (M09).
  // -------------------------------------------------------------

  fastify.get(
    '/contests/:id/queue',
    { schema: judgingQueueSwaggerSchema },
    JudgingController.queue,
  );

  fastify.post(
    '/contests/:id/videos/:videoId/rate',
    {
      schema: rateSubmissionSwaggerSchema,
      onRequest: [authenticateOptional],
      config: { rateLimit: ratingRateLimit },
    },
    JudgingController.rate,
  );

  // -------------------------------------------------------------
  // 9. Leaderboards (/api/v1/contests/:id/leaderboard)
  // M09. Public endpoint. Returns ranked APPROVED submissions
  // sorted strictly by communityScore desc, then totalVotes desc.
  // -------------------------------------------------------------

  fastify.get(
    '/contests/:id/leaderboard',
    { schema: getLeaderboardSwaggerSchema },
    LeaderboardController.getLeaderboard,
  );
};
