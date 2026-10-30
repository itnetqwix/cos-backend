import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { AdminCreatorController } from '../controllers/admin-creator.controller.js';
import { FriendshipController } from '../controllers/friendship.controller.js';
import { AuthController } from '../controllers/auth.controller.js';
import { CommentController } from '../controllers/comment.controller.js';
import { ContestController } from '../controllers/contest.controller.js';
import { RecurringContestController } from '../controllers/recurring-contest.controller.js';
import { ModerationController } from '../controllers/moderation.controller.js';
import { SubmissionController } from '../controllers/submission.controller.js';
import { NotificationController } from '../controllers/notification.controller.js';
import { VideoCategoryController } from '../controllers/video-category.controller.js';
import {
  listNotificationsSwaggerSchema,
  markAllNotificationsReadSwaggerSchema,
  markNotificationReadSwaggerSchema,
} from '../schemas/notification.schema.js';
import {
  createVideoCategorySwaggerSchema,
  deleteVideoCategorySwaggerSchema,
  listActiveVideoCategoriesSwaggerSchema,
  listAdminVideoCategoriesSwaggerSchema,
  updateVideoCategorySwaggerSchema,
} from '../schemas/video-category.schema.js';
import { UserController } from '../controllers/user.controller.js';
import {
  authenticateOptional,
  authorizeRoles,
  requireActiveCreator,
  requireReviewApprover,
  requireTester,
} from '../middleware/auth.middleware.js';
import { JudgingController } from '../controllers/judging.controller.js';
import { LeaderboardController } from '../controllers/leaderboard.controller.js';
import { VoterController } from '../controllers/voter.controller.js';
import {
  judgingQueueSwaggerSchema,
  listVotersSwaggerSchema,
  rateSubmissionSwaggerSchema,
} from '../schemas/judging.schema.js';
import { getLeaderboardSwaggerSchema } from '../schemas/leaderboard.schema.js';
import {
  registerCreatorSwaggerSchema,
  loginSwaggerSchema,
  getMeSwaggerSchema,
  updateMeSwaggerSchema,
  presignAvatarSwaggerSchema,
} from '../schemas/auth.schema.js';
import {
  createContestSwaggerSchema,
  deleteContestSwaggerSchema,
  getContestSwaggerSchema,
  presignContestBannerSwaggerSchema,
  getCreatorContestSwaggerSchema,
  listContestsSwaggerSchema,
  listCreatorContestsSwaggerSchema,
  listDeploymentActiveContestsSwaggerSchema,
  listViewableContestsSwaggerSchema,
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
  deleteMySubmissionSwaggerSchema,
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
import {
  createCommentSwaggerSchema,
  listCommentsSwaggerSchema,
} from '../schemas/comment.schema.js';
import {
  contestParticipantsSwaggerSchema,
  creatorStatusSwaggerSchema,
  deleteCreatorSubmissionSwaggerSchema,
  getCreatorSwaggerSchema,
  listCreatorActivitySwaggerSchema,
  listAdminCreatorContestsSwaggerSchema,
  listCreatorSubmissionsSwaggerSchema,
  listCreatorsSwaggerSchema,
  warnCreatorSwaggerSchema,
} from '../schemas/admin-creator.schema.js';
import {
  acceptFriendRequestSwaggerSchema,
  cancelFriendRequestSwaggerSchema,
  getFriendProfileSwaggerSchema,
  listFriendsSwaggerSchema,
  rejectFriendRequestSwaggerSchema,
  removeFriendSwaggerSchema,
  searchFriendsSwaggerSchema,
  sendFriendRequestSwaggerSchema,
} from '../schemas/friendship.schema.js';
import { ChatController } from '../controllers/chat.controller.js';
import { CounterController } from '../controllers/counter.controller.js';
import { ProductReviewController } from '../controllers/product-review.controller.js';
import { ProductReviewAdminController } from '../controllers/product-review-admin.controller.js';
import {
  chatStreamSwaggerSchema,
  listChatConversationsSwaggerSchema,
  listChatMessagesSwaggerSchema,
  markChatReadSwaggerSchema,
  presignChatAttachmentSwaggerSchema,
  sendChatMessageSwaggerSchema,
} from '../schemas/chat.schema.js';
import {
  counterStreamSwaggerSchema,
  exportCounterSwaggerSchema,
  getAdminCounterSwaggerSchema,
  getCounterSwaggerSchema,
  previewCounterSwaggerSchema,
  updateCounterSwaggerSchema,
} from '../schemas/counter.schema.js';
import {
  approveAndPublishReviewSwaggerSchema,
  approveReviewSwaggerSchema,
  createReviewSwaggerSchema,
  getPublicReviewSwaggerSchema,
  listMineReviewsSwaggerSchema,
  listPublicReviewsSwaggerSchema,
  presignReviewSwaggerSchema,
  publishReviewSwaggerSchema,
  requestChangesSwaggerSchema,
  reviewLeaderboardSwaggerSchema,
  reviewQueueSwaggerSchema,
  submitReviewSwaggerSchema,
  updateReviewSwaggerSchema,
} from '../schemas/product-review.schema.js';

import { sendError, sendSuccess } from '../utils/response.js';
import { assertDatabaseReady } from '../services/health.service.js';
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
  // Health runs SELECT 1. A database failure is 503. The body does not include the URL.
  // Root `data.name` is SYSTEM_CONSTANTS.APP_NAME, not the npm package name.
  // -------------------------------------------------------------

  fastify.get('/health', { schema: healthSwaggerSchema }, async (request, reply) => {
    try {
      await assertDatabaseReady();
    } catch (error) {
      request.log.error({ err: error }, 'health database check failed');
      return sendError(reply, 'Database is unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
    return sendSuccess(
      reply,
      {
        status: 'healthy',
        database: 'up',
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

  // Creator profile edits are scoped to request.user.id.
  // Email is not part of the body. Blocked creators are rejected.
  const creatorGuards = [
    fastify.authenticate,
    authorizeRoles(Role.CREATOR),
    requireActiveCreator,
  ];

  fastify.patch(
    '/auth/me',
    {
      schema: updateMeSwaggerSchema,
      onRequest: creatorGuards,
    },
    AuthController.updateMe,
  );

  fastify.post(
    '/auth/me/avatar/presign',
    {
      schema: presignAvatarSwaggerSchema,
      onRequest: creatorGuards,
    },
    AuthController.presignAvatar,
  );

  // Creator friends. Same creatorGuards as profile and submissions.
  // ADMIN and guests are not granted these routes.
  // Register /friends/search, /friends/:id/profile, and /friends/requests before /friends/:id.
  fastify.get(
    '/friends',
    { schema: listFriendsSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.list,
  );

  fastify.get(
    '/friends/search',
    { schema: searchFriendsSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.search,
  );

  fastify.get(
    '/friends/:id/profile',
    { schema: getFriendProfileSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.getProfile,
  );

  fastify.post(
    '/friends/requests',
    { schema: sendFriendRequestSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.send,
  );

  fastify.post(
    '/friends/requests/:id/accept',
    { schema: acceptFriendRequestSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.accept,
  );

  fastify.post(
    '/friends/requests/:id/reject',
    { schema: rejectFriendRequestSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.reject,
  );

  fastify.delete(
    '/friends/requests/:id',
    { schema: cancelFriendRequestSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.cancel,
  );

  fastify.delete(
    '/friends/:id',
    { schema: removeFriendSwaggerSchema, onRequest: creatorGuards },
    FriendshipController.remove,
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

  // Creator chat. Same creatorGuards as friends. Guests and ADMIN are denied.
  // Pending friendships cannot send or read messages.
  fastify.get(
    '/chat/conversations',
    { schema: listChatConversationsSwaggerSchema, onRequest: creatorGuards },
    ChatController.list,
  );

  fastify.get(
    '/chat/stream',
    { schema: chatStreamSwaggerSchema, onRequest: creatorGuards },
    ChatController.stream,
  );

  fastify.post(
    '/chat/attachments/presign',
    { schema: presignChatAttachmentSwaggerSchema, onRequest: creatorGuards },
    ChatController.presign,
  );

  fastify.get(
    '/chat/conversations/:id/messages',
    { schema: listChatMessagesSwaggerSchema, onRequest: creatorGuards },
    ChatController.messages,
  );

  fastify.post(
    '/chat/conversations/:id/messages',
    { schema: sendChatMessageSwaggerSchema, onRequest: creatorGuards },
    ChatController.send,
  );

  fastify.post(
    '/chat/conversations/:id/read',
    { schema: markChatReadSwaggerSchema, onRequest: creatorGuards },
    ChatController.read,
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

  fastify.get(
    '/contests/viewable',
    { schema: listViewableContestsSwaggerSchema },
    ContestController.listViewable,
  );

  fastify.get('/contests/pledge/archive', LeaderboardController.archive);

  fastify.post(
    '/contests',
    {
      schema: createContestSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.create,
  );

  fastify.post(
    '/contests/banners/presign',
    {
      schema: presignContestBannerSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.presignBanner,
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

  fastify.delete(
    '/contests/:id',
    {
      schema: deleteContestSwaggerSchema,
      onRequest: contestGuards,
    },
    ContestController.remove,
  );

  fastify.get(
    '/admin/contests/recurring',
    { onRequest: contestGuards },
    RecurringContestController.list,
  );
  fastify.post(
    '/admin/contests/recurring',
    { onRequest: contestGuards },
    RecurringContestController.create,
  );
  fastify.get(
    '/admin/contests/recurring/:id',
    { onRequest: contestGuards },
    RecurringContestController.get,
  );
  fastify.patch(
    '/admin/contests/recurring/:id',
    { onRequest: contestGuards },
    RecurringContestController.update,
  );
  fastify.post(
    '/admin/contests/recurring/:id/pause',
    { onRequest: contestGuards },
    RecurringContestController.pause,
  );
  fastify.post(
    '/admin/contests/recurring/:id/resume',
    { onRequest: contestGuards },
    RecurringContestController.resume,
  );
  fastify.get(
    '/admin/contests/recurring/:id/preview',
    { onRequest: contestGuards },
    RecurringContestController.preview,
  );
  fastify.get(
    '/admin/contests/recurring/:id/cycles',
    { onRequest: contestGuards },
    RecurringContestController.cycles,
  );

  fastify.post(
    '/admin/contests/:id/finalize-winners',
    { onRequest: contestGuards },
    ContestController.finalizeWinners,
  );
  fastify.post(
    '/admin/contests/:id/correct-winner',
    { onRequest: contestGuards },
    ContestController.correctWinner,
  );

  // -------------------------------------------------------------
  // In-app notifications. Any authenticated user reads only their own rows.
  // Register /notifications/read-all before /notifications/:id/read.
  fastify.get(
    '/notifications',
    { schema: listNotificationsSwaggerSchema, onRequest: [fastify.authenticate] },
    NotificationController.list,
  );
  fastify.post(
    '/notifications/read-all',
    { schema: markAllNotificationsReadSwaggerSchema, onRequest: [fastify.authenticate] },
    NotificationController.markAllRead,
  );
  fastify.post(
    '/notifications/:id/read',
    { schema: markNotificationReadSwaggerSchema, onRequest: [fastify.authenticate] },
    NotificationController.markRead,
  );

  // Video categories. Official catalog shared with contest categories.
  fastify.get(
    '/video-categories',
    { schema: listActiveVideoCategoriesSwaggerSchema, onRequest: [fastify.authenticate] },
    VideoCategoryController.listActive,
  );
  const videoCategoryGuards = [fastify.authenticate, authorizeRoles(Role.ADMIN)];
  fastify.get(
    '/admin/video-categories',
    { schema: listAdminVideoCategoriesSwaggerSchema, onRequest: videoCategoryGuards },
    VideoCategoryController.listAdmin,
  );
  fastify.post(
    '/admin/video-categories',
    { schema: createVideoCategorySwaggerSchema, onRequest: videoCategoryGuards },
    VideoCategoryController.create,
  );
  fastify.patch(
    '/admin/video-categories/:id',
    { schema: updateVideoCategorySwaggerSchema, onRequest: videoCategoryGuards },
    VideoCategoryController.update,
  );
  fastify.delete(
    '/admin/video-categories/:id',
    { schema: deleteVideoCategorySwaggerSchema, onRequest: videoCategoryGuards },
    VideoCategoryController.remove,
  );

  // International Ripskis Counter. Public snapshot and SSE.
  // Admin writes require ADMIN. The row is a baseline, not a per-second sample.
  fastify.get(
    '/counter',
    { schema: getCounterSwaggerSchema },
    CounterController.snapshot,
  );
  fastify.get(
    '/counter/stream',
    { schema: counterStreamSwaggerSchema },
    CounterController.stream,
  );
  const counterGuards = [fastify.authenticate, authorizeRoles(Role.ADMIN)];
  fastify.get(
    '/admin/counter',
    { schema: getAdminCounterSwaggerSchema, onRequest: counterGuards },
    CounterController.adminGet,
  );
  fastify.post(
    '/admin/counter/preview',
    { schema: previewCounterSwaggerSchema, onRequest: counterGuards },
    CounterController.preview,
  );
  fastify.get(
    '/admin/counter/export',
    { schema: exportCounterSwaggerSchema, onRequest: counterGuards },
    CounterController.exportSummary,
  );
  fastify.patch(
    '/admin/counter',
    { schema: updateCounterSwaggerSchema, onRequest: counterGuards },
    CounterController.adminUpdate,
  );

  // 6. Submissions (/api/v1/submissions)
  // M06. CREATOR only. Presign + complete (no binary through Fastify).
  // The legacy binary ingest path is intentionally not registered.
  // Register /me before /:id. Moderation routes are section 7.
  // creatorGuards is declared with the auth profile routes.
  // -------------------------------------------------------------

  fastify.get(
    '/creator/contests',
    {
      schema: listCreatorContestsSwaggerSchema,
      onRequest: creatorGuards,
    },
    ContestController.listForCreator,
  );

  fastify.get(
    '/creator/contests/:id',
    {
      schema: getCreatorContestSwaggerSchema,
      onRequest: creatorGuards,
    },
    ContestController.getForCreator,
  );

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

  fastify.delete(
    '/submissions/:id',
    {
      schema: deleteMySubmissionSwaggerSchema,
      onRequest: creatorGuards,
    },
    SubmissionController.remove,
  );

  // Comments belong to the submission. GET is public.
  // POST requires authentication. Guest authorship is NOT SPECIFIED.
  fastify.get(
    '/submissions/:id/comments',
    { schema: listCommentsSwaggerSchema },
    CommentController.list,
  );

  fastify.post(
    '/submissions/:id/comments',
    {
      schema: createCommentSwaggerSchema,
      onRequest: [fastify.authenticate],
    },
    CommentController.create,
  );

  fastify.get(
    '/submissions/:id/voters',
    { schema: listVotersSwaggerSchema },
    VoterController.list,
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

  fastify.get(
    '/admin/creators',
    {
      schema: listCreatorsSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.list,
  );

  fastify.get(
    '/admin/creators/:id/activity',
    {
      schema: listCreatorActivitySwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.activity,
  );

  fastify.get(
    '/admin/creators/:id/contests',
    {
      schema: listAdminCreatorContestsSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.contests,
  );

  fastify.get(
    '/admin/creators/:id/submissions',
    {
      schema: listCreatorSubmissionsSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.submissions,
  );

  fastify.post(
    '/admin/creators/:id/warnings',
    {
      schema: warnCreatorSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.warn,
  );

  fastify.patch(
    '/admin/creators/:id/status',
    {
      schema: creatorStatusSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.setStatus,
  );

  fastify.get(
    '/admin/contests/:id/participants',
    {
      schema: contestParticipantsSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.contestParticipants,
  );

  fastify.get(
    '/admin/creators/:id',
    {
      schema: getCreatorSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.getById,
  );

  fastify.delete(
    '/admin/submissions/:id',
    {
      schema: deleteCreatorSubmissionSwaggerSchema,
      onRequest: moderatorGuards,
    },
    AdminCreatorController.deleteSubmission,
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

  // -------------------------------------------------------------
  // 10. One Toke reviews. Pledge contest routes above are unchanged.
  // -------------------------------------------------------------

  const testerGuards = [fastify.authenticate, requireTester];
  const approverGuards = [fastify.authenticate, requireReviewApprover];

  fastify.post(
    '/toke/reviews/presign',
    { schema: presignReviewSwaggerSchema, onRequest: testerGuards },
    ProductReviewController.presign,
  );
  fastify.post(
    '/toke/reviews',
    { schema: createReviewSwaggerSchema, onRequest: testerGuards },
    ProductReviewController.create,
  );
  fastify.patch(
    '/toke/reviews/:id',
    { schema: updateReviewSwaggerSchema, onRequest: testerGuards },
    ProductReviewController.update,
  );
  fastify.post(
    '/toke/reviews/:id/submit',
    { schema: submitReviewSwaggerSchema, onRequest: testerGuards },
    ProductReviewController.submit,
  );
  fastify.get(
    '/toke/reviews/mine',
    { schema: listMineReviewsSwaggerSchema, onRequest: testerGuards },
    ProductReviewController.mine,
  );

  fastify.get(
    '/admin/toke/reviews/queue',
    { schema: reviewQueueSwaggerSchema, onRequest: approverGuards },
    ProductReviewAdminController.queue,
  );
  fastify.post(
    '/admin/toke/reviews/:id/request-changes',
    { schema: requestChangesSwaggerSchema, onRequest: approverGuards },
    ProductReviewAdminController.requestChanges,
  );
  fastify.post(
    '/admin/toke/reviews/:id/approve',
    { schema: approveReviewSwaggerSchema, onRequest: approverGuards },
    ProductReviewAdminController.approve,
  );
  fastify.post(
    '/admin/toke/reviews/:id/publish',
    { schema: publishReviewSwaggerSchema, onRequest: approverGuards },
    ProductReviewAdminController.publish,
  );
  fastify.post(
    '/admin/toke/reviews/:id/approve-and-publish',
    { schema: approveAndPublishReviewSwaggerSchema, onRequest: approverGuards },
    ProductReviewAdminController.approveAndPublish,
  );

  fastify.get(
    '/toke/reviews',
    { schema: listPublicReviewsSwaggerSchema },
    ProductReviewAdminController.list,
  );
  fastify.get(
    '/toke/reviews/:id',
    { schema: getPublicReviewSwaggerSchema },
    ProductReviewAdminController.detail,
  );
  fastify.get(
    '/toke/leaderboard',
    { schema: reviewLeaderboardSwaggerSchema },
    ProductReviewAdminController.leaderboard,
  );
};
