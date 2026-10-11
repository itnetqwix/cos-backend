import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const messageSelect = {
  id: true,
  friendshipId: true,
  senderId: true,
  body: true,
  attachmentKey: true,
  attachmentKind: true,
  attachmentMime: true,
  attachmentBytes: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

export type ChatMessageRecord = Prisma.ChatMessageGetPayload<{
  select: typeof messageSelect;
}>;

export class ChatRepository {
  static async createMessage(data: {
    friendshipId: string;
    senderId: string;
    body: string | null;
    attachmentKey: string | null;
    attachmentKind: 'IMAGE' | 'VIDEO' | null;
    attachmentMime: string | null;
    attachmentBytes: number | null;
  }): Promise<ChatMessageRecord> {
    return prisma.chatMessage.create({ data, select: messageSelect });
  }

  static async listMessages(
    friendshipId: string,
    before: Date | null,
    take: number,
  ): Promise<ChatMessageRecord[]> {
    return prisma.chatMessage.findMany({
      where: {
        friendshipId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      select: messageSelect,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  static async latestMessage(friendshipId: string): Promise<ChatMessageRecord | null> {
    return prisma.chatMessage.findFirst({
      where: { friendshipId },
      select: messageSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Messages from the other creator newer than lastReadAt.
   * A null cursor counts every message they sent.
   */
  static async countUnread(
    friendshipId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    return prisma.chatMessage.count({
      where: {
        friendshipId,
        senderId: { not: userId },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  static async getRead(friendshipId: string, userId: string): Promise<Date | null> {
    const row = await prisma.chatRead.findUnique({
      where: { friendshipId_userId: { friendshipId, userId } },
      select: { lastReadAt: true },
    });
    return row?.lastReadAt ?? null;
  }

  static async markRead(
    friendshipId: string,
    userId: string,
    lastReadAt: Date,
  ): Promise<Date> {
    const row = await prisma.chatRead.upsert({
      where: { friendshipId_userId: { friendshipId, userId } },
      create: { friendshipId, userId, lastReadAt },
      update: { lastReadAt },
      select: { lastReadAt: true },
    });
    return row.lastReadAt;
  }
}
