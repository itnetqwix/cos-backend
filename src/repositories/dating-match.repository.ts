import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { discoverCandidateQuery } from './dating-discovery.query.js';
import { DatingProfileRecord } from './dating-profile.repository.js';

const matchInclude = {
  profileLow: {
    include: {
      photos: { orderBy: { sortOrder: 'asc' as const } },
      preferences: true,
    },
  },
  profileHigh: {
    include: {
      photos: { orderBy: { sortOrder: 'asc' as const } },
      preferences: true,
    },
  },
  originatingLike: true,
  conversation: true,
} satisfies Prisma.DatingMatchInclude;

export type DatingMatchRecord = Prisma.DatingMatchGetPayload<{
  include: typeof matchInclude;
}>;

export class DatingMatchRepository {
  static async findByPair(
    profileLowId: string,
    profileHighId: string,
  ): Promise<DatingMatchRecord | null> {
    return prisma.datingMatch.findUnique({
      where: { profileLowId_profileHighId: { profileLowId, profileHighId } },
      include: matchInclude,
    });
  }

  static async findById(id: string): Promise<DatingMatchRecord | null> {
    return prisma.datingMatch.findUnique({ where: { id }, include: matchInclude });
  }

  static async listForProfile(
    profileId: string,
    activeOnly: boolean,
  ): Promise<DatingMatchRecord[]> {
    return prisma.datingMatch.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        OR: [{ profileLowId: profileId }, { profileHighId: profileId }],
      },
      include: matchInclude,
      orderBy: { matchedAt: 'desc' },
    });
  }

  static async partnerIds(profileId: string): Promise<string[]> {
    const rows = await prisma.datingMatch.findMany({
      where: { OR: [{ profileLowId: profileId }, { profileHighId: profileId }] },
      select: { profileLowId: true, profileHighId: true },
    });
    return rows.map((row) =>
      row.profileLowId === profileId ? row.profileHighId : row.profileLowId,
    );
  }

  static async createWithConversation(data: {
    profileLowId: string;
    profileHighId: string;
    originatingLikeId: string;
    firstMessage: { senderProfileId: string; body: string } | null;
  }): Promise<DatingMatchRecord> {
    return prisma.$transaction(async (tx) => {
      const match = await tx.datingMatch.create({
        data: {
          profileLowId: data.profileLowId,
          profileHighId: data.profileHighId,
          originatingLikeId: data.originatingLikeId,
        },
      });
      const snippet = data.firstMessage?.body.slice(0, 255) ?? null;
      const conversation = await tx.datingConversation.create({
        data: {
          matchId: match.id,
          lastMessageAt: data.firstMessage ? new Date() : null,
          lastMessageSnippet: snippet,
        },
      });
      if (data.firstMessage) {
        await tx.datingMessage.create({
          data: {
            conversationId: conversation.id,
            senderProfileId: data.firstMessage.senderProfileId,
            body: data.firstMessage.body,
          },
        });
      }
      const created = await tx.datingMatch.findUniqueOrThrow({
        where: { id: match.id },
        include: matchInclude,
      });
      return created;
    });
  }

  static async unmatch(input: {
    id: string;
    unmatchedById: string;
    unmatchReason: string | null;
  }): Promise<DatingMatchRecord> {
    return prisma.datingMatch.update({
      where: { id: input.id },
      data: {
        isActive: false,
        unmatchedAt: new Date(),
        unmatchedById: input.unmatchedById,
        unmatchReason: input.unmatchReason,
      },
      include: matchInclude,
    });
  }

  static async deactivatePair(
    profileLowId: string,
    profileHighId: string,
    unmatchedById: string,
  ) {
    const existing = await prisma.datingMatch.findUnique({
      where: { profileLowId_profileHighId: { profileLowId, profileHighId } },
    });
    if (!existing || !existing.isActive) return existing;
    return prisma.datingMatch.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        unmatchedAt: new Date(),
        unmatchedById,
        unmatchReason: 'Blocked',
      },
    });
  }
}

export class DatingDiscoveryRepository {
  static async searchRanked(input: {
    viewer: DatingProfileRecord;
    skip: number;
    take: number;
    now?: Date;
  }) {
    const include = {
      photos: { orderBy: { sortOrder: 'asc' as const } },
      preferences: true,
    } satisfies Prisma.DatingProfileInclude;
    const query = discoverCandidateQuery(input);
    const [idRows, totals] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>(query.list),
      prisma.$queryRaw<Array<{ total: number }>>(query.count),
    ]);
    const ids = idRows.map((row) => row.id);
    const total = Number(totals[0]?.total ?? 0);
    if (ids.length === 0) return { total, rows: [] };
    const rows = await prisma.datingProfile.findMany({
      where: { id: { in: ids } },
      include,
    });
    const order = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { total, rows };
  }
}
