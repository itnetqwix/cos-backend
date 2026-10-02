import { AccountStatus, Prisma, Role, SubmissionStatus } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface CreatorSearchParams {
  skip: number;
  limit: number;
  search?: string;
  status?: AccountStatus;
  contestId?: string;
}

const creatorSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  accountStatus: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

function creatorWhere(params: CreatorSearchParams): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { role: Role.CREATOR };
  if (params.status) where.accountStatus = params.status;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.contestId) {
    where.submissions = { some: { contestId: params.contestId } };
  }
  return where;
}

export class AdminCreatorRepository {
  static async summary() {
    const creatorWhere = { role: Role.CREATOR };
    const [totalCreators, activeCreators, blockedCreators, statusGroups] =
      await Promise.all([
        prisma.user.count({ where: creatorWhere }),
        prisma.user.count({
          where: { ...creatorWhere, accountStatus: AccountStatus.ACTIVE },
        }),
        prisma.user.count({
          where: { ...creatorWhere, accountStatus: AccountStatus.BLOCKED },
        }),
        prisma.submission.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

    const byStatus = new Map(statusGroups.map((row) => [row.status, row._count._all]));
    const approvedVideos = byStatus.get(SubmissionStatus.APPROVED) ?? 0;
    const pendingVideos = byStatus.get(SubmissionStatus.PENDING_REVIEW) ?? 0;
    const rejectedVideos = byStatus.get(SubmissionStatus.REJECTED) ?? 0;
    const flaggedVideos = byStatus.get(SubmissionStatus.FLAGGED) ?? 0;

    return {
      totalCreators,
      activeCreators,
      blockedCreators,
      totalVideos: approvedVideos + pendingVideos + rejectedVideos + flaggedVideos,
      approvedVideos,
      pendingVideos,
      rejectedVideos,
      flaggedVideos,
      underModerationVideos: pendingVideos + flaggedVideos,
    };
  }

  static async searchCreators(params: CreatorSearchParams) {
    const where = creatorWhere(params);
    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: creatorSelect,
      }),
      prisma.user.count({ where }),
    ]);
    return { users, totalCount };
  }

  static async submissionStatsForCreators(creatorIds: string[]) {
    if (creatorIds.length === 0) {
      return { byStatus: [], byContest: [], ratings: [] };
    }
    const [byStatus, byContest, ratings] = await Promise.all([
      prisma.submission.groupBy({
        by: ['creatorId', 'status'],
        where: { creatorId: { in: creatorIds } },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ['creatorId', 'contestId'],
        where: { creatorId: { in: creatorIds } },
      }),
      prisma.submission.groupBy({
        by: ['creatorId'],
        where: { creatorId: { in: creatorIds } },
        _sum: { totalVotes: true },
      }),
    ]);
    return { byStatus, byContest, ratings };
  }

  static async creatorStats(creatorId: string) {
    const [byStatus, contests, ratings, comments] = await Promise.all([
      prisma.submission.groupBy({
        by: ['status'],
        where: { creatorId },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ['contestId'],
        where: { creatorId },
      }),
      prisma.submission.aggregate({
        where: { creatorId },
        _sum: { totalVotes: true },
      }),
      prisma.comment.count({
        where: { submission: { creatorId } },
      }),
    ]);
    return { byStatus, contestCount: contests.length, ratings, comments };
  }

  static async countContestParticipants(contestId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT "creatorId")::int AS count
      FROM "submissions"
      WHERE "contestId" = ${contestId}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  static async pageContestParticipants(contestId: string, skip: number, take: number) {
    const groups = await prisma.submission.groupBy({
      by: ['creatorId'],
      where: { contestId },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      skip,
      take,
    });
    const creatorIds = groups.map((group) => group.creatorId);
    if (creatorIds.length === 0) {
      return { groups, creators: [], submissions: [] };
    }
    const [creators, submissions] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: creatorSelect,
      }),
      prisma.submission.findMany({
        where: { contestId, creatorId: { in: creatorIds } },
        select: {
          id: true,
          creatorId: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          communityScore: true,
          totalVotes: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return { groups, creators, submissions };
  }
}
