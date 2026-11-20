import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { DatingChatController } from '../controllers/dating-chat.controller.js';
import { DatingMatchController } from '../controllers/dating-match.controller.js';
import {
  DatingPhotoController,
  DatingProfileController,
} from '../controllers/dating-profile.controller.js';
import { DatingSafetyController } from '../controllers/dating-safety.controller.js';
import { authorizeRoles, requireActiveCreator } from '../middleware/auth.middleware.js';
import {
  datingLikeRateLimit,
  datingMessageRateLimit,
  datingPhotoPresignRateLimit,
  datingReportRateLimit,
  datingStreamRateLimit,
} from '../plugins/rate-limit.js';
import {
  adminBanDatingProfileSwaggerSchema,
  adminDatingReportSwaggerSchema,
  adminDatingReportsSwaggerSchema,
  adminResolveDatingReportSwaggerSchema,
  adminVerificationSwaggerSchema,
  blockDatingSwaggerSchema,
  confirmDatingPhotoSwaggerSchema,
  confirmDatingVerificationSwaggerSchema,
  deleteDatingPhotoSwaggerSchema,
  deleteMyDatingProfileSwaggerSchema,
  discoverDatingSwaggerSchema,
  datingStreamSwaggerSchema,
  getDatingPreferencesSwaggerSchema,
  getDatingProfileSwaggerSchema,
  getMatchSwaggerSchema,
  getMyDatingProfileSwaggerSchema,
  likeDatingSwaggerSchema,
  listBlocksSwaggerSchema,
  listDatingConversationsSwaggerSchema,
  listDatingMessagesSwaggerSchema,
  listDatingNotificationsSwaggerSchema,
  listMatchesSwaggerSchema,
  onboardDatingSwaggerSchema,
  passDatingSwaggerSchema,
  patchDatingPreferencesSwaggerSchema,
  patchDatingStatusSwaggerSchema,
  patchMyDatingProfileSwaggerSchema,
  presignDatingChatSwaggerSchema,
  presignDatingPhotoSwaggerSchema,
  presignDatingVerificationSwaggerSchema,
  primaryDatingPhotoSwaggerSchema,
  readAllDatingNotificationsSwaggerSchema,
  readDatingConversationSwaggerSchema,
  readDatingNotificationSwaggerSchema,
  receivedLikesSwaggerSchema,
  reorderDatingPhotosSwaggerSchema,
  reportDatingSwaggerSchema,
  sendDatingMessageSwaggerSchema,
  sentLikesSwaggerSchema,
  unblockDatingSwaggerSchema,
  unmatchSwaggerSchema,
} from '../schemas/dating.schema.js';

export async function registerDatingRoutes(fastify: FastifyInstance): Promise<void> {
  const member = [fastify.authenticate, requireActiveCreator];
  const admin = [fastify.authenticate, authorizeRoles(Role.ADMIN)];

  fastify.get(
    '/dating/profile/me',
    { schema: getMyDatingProfileSwaggerSchema, onRequest: member },
    DatingProfileController.getMine,
  );
  fastify.post(
    '/dating/profile/onboarding',
    { schema: onboardDatingSwaggerSchema, onRequest: member },
    DatingProfileController.onboard,
  );
  fastify.patch(
    '/dating/profile/me',
    { schema: patchMyDatingProfileSwaggerSchema, onRequest: member },
    DatingProfileController.update,
  );
  fastify.patch(
    '/dating/profile/me/status',
    { schema: patchDatingStatusSwaggerSchema, onRequest: member },
    DatingProfileController.status,
  );
  fastify.delete(
    '/dating/profile/me',
    { schema: deleteMyDatingProfileSwaggerSchema, onRequest: member },
    DatingProfileController.remove,
  );
  fastify.get(
    '/dating/profile/:id',
    { schema: getDatingProfileSwaggerSchema, onRequest: member },
    DatingProfileController.getPublic,
  );

  fastify.post(
    '/dating/photos/presign',
    {
      schema: presignDatingPhotoSwaggerSchema,
      onRequest: member,
      config: { rateLimit: datingPhotoPresignRateLimit },
    },
    DatingPhotoController.presign,
  );
  fastify.post(
    '/dating/photos',
    { schema: confirmDatingPhotoSwaggerSchema, onRequest: member },
    DatingPhotoController.confirm,
  );
  fastify.patch(
    '/dating/photos/reorder',
    { schema: reorderDatingPhotosSwaggerSchema, onRequest: member },
    DatingPhotoController.reorder,
  );
  fastify.patch(
    '/dating/photos/:id/primary',
    { schema: primaryDatingPhotoSwaggerSchema, onRequest: member },
    DatingPhotoController.primary,
  );
  fastify.delete(
    '/dating/photos/:id',
    { schema: deleteDatingPhotoSwaggerSchema, onRequest: member },
    DatingPhotoController.remove,
  );

  fastify.get(
    '/dating/preferences',
    { schema: getDatingPreferencesSwaggerSchema, onRequest: member },
    DatingProfileController.getPreferences,
  );
  fastify.patch(
    '/dating/preferences',
    { schema: patchDatingPreferencesSwaggerSchema, onRequest: member },
    DatingProfileController.updatePreferences,
  );

  fastify.get(
    '/dating/discover',
    { schema: discoverDatingSwaggerSchema, onRequest: member },
    DatingMatchController.discover,
  );
  fastify.post(
    '/dating/discover/pass',
    { schema: passDatingSwaggerSchema, onRequest: member },
    DatingMatchController.pass,
  );
  fastify.post(
    '/dating/likes',
    {
      schema: likeDatingSwaggerSchema,
      onRequest: member,
      config: { rateLimit: datingLikeRateLimit },
    },
    DatingMatchController.like,
  );
  fastify.get(
    '/dating/likes/received',
    { schema: receivedLikesSwaggerSchema, onRequest: member },
    DatingMatchController.received,
  );
  fastify.get(
    '/dating/likes/sent',
    { schema: sentLikesSwaggerSchema, onRequest: member },
    DatingMatchController.sent,
  );
  fastify.get(
    '/dating/matches',
    { schema: listMatchesSwaggerSchema, onRequest: member },
    DatingMatchController.list,
  );
  fastify.get(
    '/dating/matches/:id',
    { schema: getMatchSwaggerSchema, onRequest: member },
    DatingMatchController.get,
  );
  fastify.post(
    '/dating/matches/:id/unmatch',
    { schema: unmatchSwaggerSchema, onRequest: member },
    DatingMatchController.unmatch,
  );

  fastify.get(
    '/dating/conversations',
    { schema: listDatingConversationsSwaggerSchema, onRequest: member },
    DatingChatController.list,
  );
  fastify.get(
    '/dating/conversations/:id/messages',
    { schema: listDatingMessagesSwaggerSchema, onRequest: member },
    DatingChatController.messages,
  );
  fastify.post(
    '/dating/conversations/:id/messages',
    {
      schema: sendDatingMessageSwaggerSchema,
      onRequest: member,
      config: { rateLimit: datingMessageRateLimit },
    },
    DatingChatController.send,
  );
  fastify.post(
    '/dating/conversations/:id/read',
    { schema: readDatingConversationSwaggerSchema, onRequest: member },
    DatingChatController.read,
  );
  fastify.post(
    '/dating/chat/attachments/presign',
    { schema: presignDatingChatSwaggerSchema, onRequest: member },
    DatingChatController.presign,
  );
  fastify.get(
    '/dating/chat/stream',
    {
      schema: datingStreamSwaggerSchema,
      onRequest: member,
      config: { rateLimit: datingStreamRateLimit },
    },
    DatingChatController.stream,
  );

  fastify.post(
    '/dating/blocks',
    { schema: blockDatingSwaggerSchema, onRequest: member },
    DatingSafetyController.block,
  );
  fastify.delete(
    '/dating/blocks/:id',
    { schema: unblockDatingSwaggerSchema, onRequest: member },
    DatingSafetyController.unblock,
  );
  fastify.get(
    '/dating/blocks',
    { schema: listBlocksSwaggerSchema, onRequest: member },
    DatingSafetyController.listBlocks,
  );
  fastify.post(
    '/dating/reports',
    {
      schema: reportDatingSwaggerSchema,
      onRequest: member,
      config: { rateLimit: datingReportRateLimit },
    },
    DatingSafetyController.report,
  );
  fastify.get(
    '/dating/notifications',
    { schema: listDatingNotificationsSwaggerSchema, onRequest: member },
    DatingSafetyController.listNotifications,
  );
  fastify.post(
    '/dating/notifications/read-all',
    { schema: readAllDatingNotificationsSwaggerSchema, onRequest: member },
    DatingSafetyController.readAllNotifications,
  );
  fastify.post(
    '/dating/notifications/:id/read',
    { schema: readDatingNotificationSwaggerSchema, onRequest: member },
    DatingSafetyController.readNotification,
  );

  fastify.post(
    '/dating/verification/presign',
    { schema: presignDatingVerificationSwaggerSchema, onRequest: member },
    DatingProfileController.presignVerification,
  );
  fastify.post(
    '/dating/verification',
    { schema: confirmDatingVerificationSwaggerSchema, onRequest: member },
    DatingProfileController.confirmVerification,
  );

  fastify.get(
    '/admin/dating/reports',
    { schema: adminDatingReportsSwaggerSchema, onRequest: admin },
    DatingSafetyController.adminList,
  );
  fastify.get(
    '/admin/dating/reports/:id',
    { schema: adminDatingReportSwaggerSchema, onRequest: admin },
    DatingSafetyController.adminGet,
  );
  fastify.patch(
    '/admin/dating/reports/:id',
    { schema: adminResolveDatingReportSwaggerSchema, onRequest: admin },
    DatingSafetyController.adminResolve,
  );
  fastify.patch(
    '/admin/dating/profiles/:id/ban',
    { schema: adminBanDatingProfileSwaggerSchema, onRequest: admin },
    DatingSafetyController.adminBan,
  );
  fastify.patch(
    '/admin/dating/profiles/:id/verification',
    { schema: adminVerificationSwaggerSchema, onRequest: admin },
    DatingProfileController.reviewVerification,
  );
}
