import { LikeTargetType, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const likeInclude = {
  senderProfile: {
    include: {
      photos: { orderBy: { sortOrder: 'asc' as const } },
      preferences: true,
    },
  },
  receiverProfile: {
    include: {
      photos: { orderBy: { sortOrder: 'asc' as const } },
      preferences: true,
    },
  },
} satisfies Prisma.DatingLikeInclude;

export type DatingLikeRecord = Prisma.DatingLikeGetPayload<{
  include: typeof likeInclude;
}>;

export class DatingLikeRepository {
  static async findPair(
    senderProfileId: string,
    receiverProfileId: string,
  ): Promise<DatingLikeRecord | null> {
    return prisma.datingLike.findUnique({
      where: {
        senderProfileId_receiverProfileId: { senderProfileId, receiverProfileId },
      },
      include: likeInclude,
    });
  }

  static async create(data: {
    senderProfileId: string;
    receiverProfileId: string;
    isPass: boolean;
    comment: string | null;
    targetType: LikeTargetType;
    targetId: string | null;
  }): Promise<DatingLikeRecord> {
    return prisma.datingLike.create({ data, include: likeInclude });
  }

  static async update(
    id: string,
    data: {
      isPass: boolean;
      comment: string | null;
      targetType: LikeTargetType;
      targetId: string | null;
    },
  ): Promise<DatingLikeRecord> {
    return prisma.datingLike.update({ where: { id }, data, include: likeInclude });
  }

  static async countSince(
    senderProfileId: string,
    since: Date,
    isPass: boolean,
  ): Promise<number> {
    return prisma.datingLike.count({
      where: { senderProfileId, isPass, createdAt: { gte: since } },
    });
  }

  static async listForSender(
    senderProfileId: string,
  ): Promise<Array<{ receiverProfileId: string }>> {
    return prisma.datingLike.findMany({
      where: { senderProfileId },
      select: { receiverProfileId: true },
    });
  }

  static async listReceived(input: {
    receiverProfileId: string;
    excludedSenderIds: string[];
    skip: number;
    take: number;
  }): Promise<{ total: number; rows: DatingLikeRecord[] }> {
    const where: Prisma.DatingLikeWhereInput = {
      receiverProfileId: input.receiverProfileId,
      isPass: false,
      ...(input.excludedSenderIds.length > 0
        ? { senderProfileId: { notIn: input.excludedSenderIds } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.datingLike.count({ where }),
      prisma.datingLike.findMany({
        where,
        include: likeInclude,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { total, rows };
  }

  static async listSent(input: {
    senderProfileId: string;
    skip: number;
    take: number;
  }): Promise<{ total: number; rows: DatingLikeRecord[] }> {
    const where = { senderProfileId: input.senderProfileId, isPass: false };
    const [total, rows] = await Promise.all([
      prisma.datingLike.count({ where }),
      prisma.datingLike.findMany({
        where,
        include: likeInclude,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { total, rows };
  }
}
