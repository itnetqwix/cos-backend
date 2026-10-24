import { NotificationType, Role } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  submissionId?: string | null;
}

export type NotificationRecord = Awaited<
  ReturnType<typeof NotificationRepository.listForUser>
>[number];

export class NotificationRepository {
  /** Rows that collide on (userId, type, submissionId) are skipped. */
  static async createMany(rows: CreateNotificationData[]) {
    if (rows.length === 0) return { count: 0 };
    return prisma.notification.createMany({
      data: rows.map((row) => ({
        userId: row.userId,
        type: row.type,
        title: row.title,
        body: row.body ?? null,
        submissionId: row.submissionId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  static async listAdminIds(): Promise<string[]> {
    const admins = await prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    return admins.map((admin) => admin.id);
  }

  static async listForUser(userId: string, take: number) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  static async countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  static async markRead(userId: string, id: string) {
    return prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  static async exists(userId: string, id: string) {
    const row = await prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    return Boolean(row);
  }

  static async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
