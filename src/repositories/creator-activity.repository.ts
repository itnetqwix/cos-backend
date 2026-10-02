import { CreatorActivityAction, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const actorSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

export interface CreateCreatorActivityData {
  creatorId: string;
  action: CreatorActivityAction;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
  relatedSubmissionId?: string | null;
  relatedContestId?: string | null;
  performedByUserId?: string | null;
}

export class CreatorActivityRepository {
  static async create(data: CreateCreatorActivityData) {
    return prisma.creatorActivityLog.create({
      data: {
        creatorId: data.creatorId,
        action: data.action,
        description: data.description ?? null,
        metadata: data.metadata,
        relatedSubmissionId: data.relatedSubmissionId ?? null,
        relatedContestId: data.relatedContestId ?? null,
        performedByUserId: data.performedByUserId ?? null,
      },
    });
  }

  static async findLatest(creatorId: string) {
    return prisma.creatorActivityLog.findFirst({
      where: { creatorId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
  }

  static async latestForCreators(creatorIds: string[]) {
    if (creatorIds.length === 0) return [];
    return prisma.creatorActivityLog.groupBy({
      by: ['creatorId'],
      where: { creatorId: { in: creatorIds } },
      _max: { createdAt: true },
    });
  }

  static async pageByCreator(creatorId: string, skip: number, take: number) {
    const where = { creatorId };
    const [rows, totalCount] = await Promise.all([
      prisma.creatorActivityLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: {
          performedBy: { select: actorSelect },
        },
      }),
      prisma.creatorActivityLog.count({ where }),
    ]);
    return { rows, totalCount };
  }
}
