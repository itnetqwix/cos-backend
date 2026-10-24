import { NotificationType } from '@prisma/client';
import {
  NotificationRecord,
  NotificationRepository,
} from '../repositories/notification.repository.js';
import { NotFoundError } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * In-app notifications for moderation events.
 *
 * A failed write is logged and does not roll back the upload or moderation
 * decision that already succeeded. Duplicates for the same user, type, and
 * submission are skipped by the unique key.
 *
 * Creators are also notified when an admin deletes their submission; the
 * admin's reason is included in the body.
 *
 * Retention, email delivery, and notifications for reject or flag are
 * NOT SPECIFIED and not implemented.
 */

const LIST_LIMIT = 30;

interface SubmissionRef {
  id: string;
  title: string;
  creatorId: string;
  contest: { title: string };
}

export interface NotificationList {
  items: NotificationRecord[];
  unreadCount: number;
}

export class NotificationService {
  static async notifySubmissionPendingReview(submission: SubmissionRef): Promise<void> {
    try {
      const adminIds = await NotificationRepository.listAdminIds();
      await NotificationRepository.createMany(
        adminIds.map((userId) => ({
          userId,
          type: NotificationType.SUBMISSION_PENDING_REVIEW,
          title: 'Video awaiting approval',
          body: `"${submission.title}" was submitted to ${submission.contest.title} and is awaiting review.`,
          submissionId: submission.id,
        })),
      );
    } catch (error) {
      logger.error('pending review notification failed', error);
    }
  }

  static async notifySubmissionApproved(submission: SubmissionRef): Promise<void> {
    try {
      await NotificationRepository.createMany([
        {
          userId: submission.creatorId,
          type: NotificationType.SUBMISSION_APPROVED,
          title: 'Video approved',
          body: `"${submission.title}" was approved and is now live in ${submission.contest.title}.`,
          submissionId: submission.id,
        },
      ]);
    } catch (error) {
      logger.error('approval notification failed', error);
    }
  }

  static async notifySubmissionDeleted(
    submission: SubmissionRef,
    reason: string,
  ): Promise<void> {
    try {
      await NotificationRepository.createMany([
        {
          userId: submission.creatorId,
          type: NotificationType.SUBMISSION_DELETED,
          title: 'Video deleted',
          body: `"${submission.title}" was removed from ${submission.contest.title} by an admin. Reason: ${reason}`,
          submissionId: submission.id,
        },
      ]);
    } catch (error) {
      logger.error('deletion notification failed', error);
    }
  }

  static async list(userId: string): Promise<NotificationList> {
    const [items, unreadCount] = await Promise.all([
      NotificationRepository.listForUser(userId, LIST_LIMIT),
      NotificationRepository.countUnread(userId),
    ]);
    return { items, unreadCount };
  }

  static async markRead(userId: string, id: string): Promise<void> {
    const result = await NotificationRepository.markRead(userId, id);
    if (result.count === 0 && !(await NotificationRepository.exists(userId, id))) {
      throw new NotFoundError('Notification not found');
    }
  }

  static async markAllRead(userId: string): Promise<void> {
    await NotificationRepository.markAllRead(userId);
  }
}
