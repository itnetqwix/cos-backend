import { ContestStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const contestInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
    },
  },
} satisfies Prisma.ContestInclude;

export type ContestRecord = Prisma.ContestGetPayload<{
  include: typeof contestInclude;
}>;

export interface ContestListFilters {
  status?: ContestStatus;
  statuses?: ContestStatus[];
  categorySlug?: string;
}

export interface CreateContestData {
  categoryId: string | null;
  title: string;
  description: string;
  tagline: string | null;
  bannerUrl: string | null;
  thumbnailUrl: string | null;
  startDate: Date;
  endDate: Date;
  prizeSummary: string | null;
  rules: Prisma.InputJsonValue | null;
  autoAdvanceDelayMs: number;
}

export type UpdateContestData = {
  categoryId?: string | null;
  title?: string;
  description?: string;
  tagline?: string | null;
  bannerUrl?: string | null;
  thumbnailUrl?: string | null;
  status?: ContestStatus;
  startDate?: Date;
  endDate?: Date;
  prizeSummary?: string | null;
  rules?: Prisma.InputJsonValue | null;
  autoAdvanceDelayMs?: number;
};

/**
 * Contest persistence (M05-P02-T01).
 * List filters are organization, status, and category slug.
 * No submission, upload, or judging queries (M06+).
 */
export class ContestRepository {
  static async create(data: CreateContestData): Promise<ContestRecord> {
    return prisma.contest.create({
      data: {
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        tagline: data.tagline,
        bannerUrl: data.bannerUrl,
        thumbnailUrl: data.thumbnailUrl,
        startDate: data.startDate,
        endDate: data.endDate,
        prizeSummary: data.prizeSummary,
        rules: data.rules === null ? Prisma.JsonNull : data.rules,
        autoAdvanceDelayMs: data.autoAdvanceDelayMs,
        status: ContestStatus.DRAFT,
      },
      include: contestInclude,
    });
  }

  static async findById(id: string): Promise<ContestRecord | null> {
    return prisma.contest.findUnique({
      where: { id },
      include: contestInclude,
    });
  }

  static async list(filters: ContestListFilters): Promise<ContestRecord[]> {
    return prisma.contest.findMany({
      where: {
        status: filters.statuses ? { in: filters.statuses } : filters.status,
        category: filters.categorySlug ? { slug: filters.categorySlug } : undefined,
      },
      include: contestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async update(id: string, data: UpdateContestData): Promise<ContestRecord> {
    return prisma.contest.update({
      where: { id },
      data: {
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        tagline: data.tagline,
        bannerUrl: data.bannerUrl,
        thumbnailUrl: data.thumbnailUrl,
        status: data.status,
        startDate: data.startDate,
        endDate: data.endDate,
        prizeSummary: data.prizeSummary,
        rules:
          data.rules === undefined
            ? undefined
            : data.rules === null
              ? Prisma.JsonNull
              : data.rules,
        autoAdvanceDelayMs: data.autoAdvanceDelayMs,
      },
      include: contestInclude,
    });
  }

  /**
   * Hard-delete. Submission and Rating rows cascade from the Prisma relations.
   * Audit logs keep the actor row and null the submission reference.
   */
  static async deleteById(id: string): Promise<void> {
    await prisma.contest.delete({ where: { id } });
  }
}
