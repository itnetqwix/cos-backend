import { ChatAttachmentKind, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const messageSelect = {
  id: true,
  conversationId: true,
  senderProfileId: true,
  body: true,
  attachmentKey: true,
  attachmentKind: true,
  attachmentMime: true,
  attachmentBytes: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.DatingMessageSelect;

export type DatingMessageRecord = Prisma.DatingMessageGetPayload<{
  select: typeof messageSelect;
}>;

const conversationInclude = {
  match: true,
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: messageSelect,
  },
} satisfies Prisma.DatingConversationInclude;

export type DatingConversationRecord = Prisma.DatingConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export class DatingChatRepository {
  static async findById(id: string): Promise<DatingConversationRecord | null> {
    return prisma.datingConversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
  }

  static async findByMatchId(matchId: string): Promise<DatingConversationRecord | null> {
    return prisma.datingConversation.findUnique({
      where: { matchId },
      include: conversationInclude,
    });
  }

  static async listForMatches(matchIds: string[]): Promise<DatingConversationRecord[]> {
    if (matchIds.length === 0) return [];
    return prisma.datingConversation.findMany({
      where: { matchId: { in: matchIds } },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  static async createMessage(data: {
    conversationId: string;
    senderProfileId: string;
    body: string | null;
    attachmentKey: string | null;
    attachmentKind: ChatAttachmentKind | null;
    attachmentMime: string | null;
    attachmentBytes: number | null;
  }): Promise<DatingMessageRecord> {
    return prisma.$transaction(async (tx) => {
      const message = await tx.datingMessage.create({ data, select: messageSelect });
      const snippet = (data.body ?? (data.attachmentKey ? 'Photo' : '')).slice(0, 255);
      await tx.datingConversation.update({
        where: { id: data.conversationId },
        data: { lastMessageAt: message.createdAt, lastMessageSnippet: snippet },
      });
      return message;
    });
  }

  static async listMessages(input: {
    conversationId: string;
    skip: number;
    take: number;
  }): Promise<{ total: number; rows: DatingMessageRecord[] }> {
    const where = { conversationId: input.conversationId };
    const [total, desc] = await Promise.all([
      prisma.datingMessage.count({ where }),
      prisma.datingMessage.findMany({
        where,
        select: messageSelect,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { total, rows: desc.reverse() };
  }

  static async countSince(senderProfileId: string, since: Date): Promise<number> {
    return prisma.datingMessage.count({
      where: { senderProfileId, createdAt: { gte: since } },
    });
  }

  static async unreadCounts(
    conversationIds: string[],
    readerProfileId: string,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await prisma.datingMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        senderProfileId: { not: readerProfileId },
        isRead: false,
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.conversationId, row._count._all]));
  }

  static async markRead(conversationId: string, readerProfileId: string, readAt: Date) {
    return prisma.datingMessage.updateMany({
      where: {
        conversationId,
        senderProfileId: { not: readerProfileId },
        isRead: false,
      },
      data: { isRead: true, readAt },
    });
  }

  static async latestOtherMessage(conversationId: string, senderProfileId: string) {
    return prisma.datingMessage.findFirst({
      where: { conversationId, senderProfileId },
      select: messageSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
}
