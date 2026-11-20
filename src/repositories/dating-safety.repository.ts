import {
  DatingNotificationType,
  DatingReportCategory,
  DatingReportStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/database.js';

const blockInclude = {
  blockedProfile: {
    include: { photos: { orderBy: { sortOrder: 'asc' as const } } },
  },
} satisfies Prisma.DatingBlockInclude;

export type DatingBlockRecord = Prisma.DatingBlockGetPayload<{
  include: typeof blockInclude;
}>;

const reportInclude = {
  reporterProfile: {
    include: { photos: { orderBy: { sortOrder: 'asc' as const } } },
  },
  reportedProfile: {
    include: { photos: { orderBy: { sortOrder: 'asc' as const } } },
  },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.DatingReportInclude;

export type DatingReportRecord = Prisma.DatingReportGetPayload<{
  include: typeof reportInclude;
}>;

export class DatingSafetyRepository {
  static async findBlock(blockerProfileId: string, blockedProfileId: string) {
    return prisma.datingBlock.findUnique({
      where: {
        blockerProfileId_blockedProfileId: { blockerProfileId, blockedProfileId },
      },
    });
  }

  static async isEitherBlocked(profileA: string, profileB: string): Promise<boolean> {
    const count = await prisma.datingBlock.count({
      where: {
        OR: [
          { blockerProfileId: profileA, blockedProfileId: profileB },
          { blockerProfileId: profileB, blockedProfileId: profileA },
        ],
      },
    });
    return count > 0;
  }

  static async blockedIds(profileId: string): Promise<string[]> {
    const rows = await prisma.datingBlock.findMany({
      where: { OR: [{ blockerProfileId: profileId }, { blockedProfileId: profileId }] },
      select: { blockerProfileId: true, blockedProfileId: true },
    });
    return rows.map((row) =>
      row.blockerProfileId === profileId ? row.blockedProfileId : row.blockerProfileId,
    );
  }

  static async createBlock(blockerProfileId: string, blockedProfileId: string) {
    return prisma.datingBlock.create({
      data: { blockerProfileId, blockedProfileId },
      include: blockInclude,
    });
  }

  static async deleteBlock(id: string): Promise<void> {
    await prisma.datingBlock.delete({ where: { id } });
  }

  static async findBlockById(id: string): Promise<DatingBlockRecord | null> {
    return prisma.datingBlock.findUnique({ where: { id }, include: blockInclude });
  }

  static async listBlocks(blockerProfileId: string): Promise<DatingBlockRecord[]> {
    return prisma.datingBlock.findMany({
      where: { blockerProfileId },
      include: blockInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async createReport(data: {
    reporterProfileId: string;
    reportedProfileId: string;
    reasonCategory: DatingReportCategory;
    details: string | null;
    evidencePhotoKeys?: string[];
  }): Promise<DatingReportRecord> {
    return prisma.datingReport.create({
      data: {
        ...data,
        evidencePhotoKeys: data.evidencePhotoKeys ?? [],
      },
      include: reportInclude,
    });
  }

  static async countReportsSince(
    reporterProfileId: string,
    since: Date,
  ): Promise<number> {
    return prisma.datingReport.count({
      where: { reporterProfileId, createdAt: { gte: since } },
    });
  }

  static async recentAgainst(reportedProfileId: string, since: Date) {
    return prisma.datingReport.findMany({
      where: { reportedProfileId, createdAt: { gte: since } },
      select: { reporterProfileId: true, reasonCategory: true },
    });
  }

  static async listReports(input: {
    status?: DatingReportStatus;
    reasonCategory?: DatingReportCategory;
    skip: number;
    take: number;
  }): Promise<{ total: number; rows: DatingReportRecord[] }> {
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.reasonCategory ? { reasonCategory: input.reasonCategory } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.datingReport.count({ where }),
      prisma.datingReport.findMany({
        where,
        include: reportInclude,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { total, rows };
  }

  static async findReport(id: string): Promise<DatingReportRecord | null> {
    return prisma.datingReport.findUnique({ where: { id }, include: reportInclude });
  }

  static async countOpenSolicitations(): Promise<number> {
    return prisma.datingReport.count({
      where: {
        status: DatingReportStatus.PENDING,
        reasonCategory: DatingReportCategory.SOLICITATION_OR_DRUG_DEALING,
      },
    });
  }

  static async historyForProfile(reportedProfileId: string, excludeId: string) {
    return prisma.datingReport.findMany({
      where: { reportedProfileId, id: { not: excludeId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        reasonCategory: true,
        createdAt: true,
        reviewedAt: true,
        resolutionNotes: true,
      },
    });
  }

  static async updateReport(
    id: string,
    data: Prisma.DatingReportUpdateInput,
  ): Promise<DatingReportRecord> {
    return prisma.datingReport.update({ where: { id }, data, include: reportInclude });
  }
}

const notificationSelect = {
  id: true,
  profileId: true,
  type: true,
  title: true,
  body: true,
  relatedEntityId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.DatingNotificationSelect;

export type DatingNotificationRecord = Prisma.DatingNotificationGetPayload<{
  select: typeof notificationSelect;
}>;

export class DatingNotificationRepository {
  static async create(data: {
    profileId: string;
    type: DatingNotificationType;
    title: string;
    body: string | null;
    relatedEntityId: string | null;
  }): Promise<DatingNotificationRecord> {
    return prisma.datingNotification.create({ data, select: notificationSelect });
  }

  static async list(input: {
    profileId: string;
    skip: number;
    take: number;
  }): Promise<{ total: number; rows: DatingNotificationRecord[] }> {
    const where = { profileId: input.profileId };
    const [total, rows] = await Promise.all([
      prisma.datingNotification.count({ where }),
      prisma.datingNotification.findMany({
        where,
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
    ]);
    return { total, rows };
  }

  static async markRead(id: string, profileId: string, readAt: Date) {
    return prisma.datingNotification.updateMany({
      where: { id, profileId, readAt: null },
      data: { readAt },
    });
  }

  static async markAllRead(profileId: string, readAt: Date) {
    return prisma.datingNotification.updateMany({
      where: { profileId, readAt: null },
      data: { readAt },
    });
  }

  static async markRelatedRead(
    profileId: string,
    type: DatingNotificationType,
    relatedEntityId: string,
    readAt: Date,
  ) {
    return prisma.datingNotification.updateMany({
      where: { profileId, type, relatedEntityId, readAt: null },
      data: { readAt },
    });
  }
}
