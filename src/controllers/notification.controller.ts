import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { NotificationRecord } from '../repositories/notification.repository.js';
import { notificationIdParamSchema } from '../schemas/notification.schema.js';
import { NotificationService } from '../services/notification.service.js';
import { sendSuccess } from '../utils/response.js';

function toNotificationView(row: NotificationRecord) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    submissionId: row.submissionId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class NotificationController {
  /**
   * GET /api/v1/notifications
   */
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const { items, unreadCount } = await NotificationService.list(request.user.id);
    return sendSuccess(
      reply,
      { items: items.map(toNotificationView), unreadCount },
      'Notifications retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/notifications/:id/read
   */
  static async markRead(request: FastifyRequest, reply: FastifyReply) {
    const { id } = notificationIdParamSchema.parse(request.params);
    await NotificationService.markRead(request.user.id, id);
    return sendSuccess(reply, null, 'Notification marked as read', HTTP_STATUS.OK);
  }

  /**
   * POST /api/v1/notifications/read-all
   */
  static async markAllRead(request: FastifyRequest, reply: FastifyReply) {
    await NotificationService.markAllRead(request.user.id);
    return sendSuccess(reply, null, 'All notifications marked as read', HTTP_STATUS.OK);
  }
}
