import { AccountStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/database.js';

const personSelect = {
  id: true,
  name: true,
  avatarObjectKey: true,
} satisfies Prisma.UserSelect;

const friendProfileUserSelect = {
  id: true,
  name: true,
  avatarObjectKey: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const friendshipInclude = {
  userLow: { select: personSelect },
  userHigh: { select: personSelect },
} satisfies Prisma.FriendshipInclude;

export type FriendshipRecord = Prisma.FriendshipGetPayload<{
  include: typeof friendshipInclude;
}>;

export type CreatorSearchHit = Prisma.UserGetPayload<{ select: typeof personSelect }>;

export type FriendProfileUser = Prisma.UserGetPayload<{
  select: typeof friendProfileUserSelect;
}>;

export class FriendshipRepository {
  static async findActiveCreator(id: string): Promise<CreatorSearchHit | null> {
    return prisma.user.findFirst({
      where: { id, role: Role.CREATOR, accountStatus: AccountStatus.ACTIVE },
      select: personSelect,
    });
  }

  static async findActiveFriendUser(id: string): Promise<FriendProfileUser | null> {
    return prisma.user.findFirst({
      where: { id, role: Role.CREATOR, accountStatus: AccountStatus.ACTIVE },
      select: friendProfileUserSelect,
    });
  }

  static async searchCreators(
    query: string,
    excludeUserId: string,
  ): Promise<CreatorSearchHit[]> {
    return prisma.user.findMany({
      where: {
        role: Role.CREATOR,
        accountStatus: AccountStatus.ACTIVE,
        id: { not: excludeUserId },
        name: { contains: query, mode: 'insensitive' },
      },
      select: personSelect,
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  static async findPair(
    userLowId: string,
    userHighId: string,
  ): Promise<FriendshipRecord | null> {
    return prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      include: friendshipInclude,
    });
  }

  static async findByPairs(
    pairs: Array<{ userLowId: string; userHighId: string }>,
  ): Promise<FriendshipRecord[]> {
    if (pairs.length === 0) return [];
    return prisma.friendship.findMany({
      where: { OR: pairs },
      include: friendshipInclude,
    });
  }

  static async findById(id: string): Promise<FriendshipRecord | null> {
    return prisma.friendship.findUnique({
      where: { id },
      include: friendshipInclude,
    });
  }

  static async listForUser(userId: string): Promise<FriendshipRecord[]> {
    return prisma.friendship.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      include: friendshipInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async create(data: {
    userLowId: string;
    userHighId: string;
    requesterId: string;
  }): Promise<FriendshipRecord> {
    return prisma.friendship.create({
      data,
      include: friendshipInclude,
    });
  }

  static async markAccepted(id: string): Promise<FriendshipRecord> {
    return prisma.friendship.update({
      where: { id },
      data: { status: 'ACCEPTED' },
      include: friendshipInclude,
    });
  }

  static async deleteById(id: string): Promise<void> {
    await prisma.friendship.delete({ where: { id } });
  }
}
