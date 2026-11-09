import { Prisma, Role, SubmissionStatus, VideoDomain } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ForbiddenError, NotFoundError } from '../utils/response.js';
import { resolveSubmissionMedia } from './storage.service.js';
import { ModerationActor, ModerationService } from './moderation.service.js';
import { ListPledgeVideosQuery } from '../schemas/pledge-video.schema.js';

const submissionInclude = {
  contest: {
    select: {
      id: true,
      title: true,
      status: true,
      seriesSlug: true,
      cycleMonth: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
  creator: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarObjectKey: true,
    },
  },
  deletedBy: {
    select: {
      id: true,
      name: true,
    },
  },
  videoCategory: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
    },
  },
} satisfies Prisma.SubmissionInclude;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface PledgeSubmissionViewInput {
  id: string;
  domain: VideoDomain;
  contestId: string;
  creatorId: string;
  title: string;
  description: string | null;
  videoUrl: string;
  objectKey: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  status: SubmissionStatus;
  rejectionReason: string | null;
  moderatedById: string | null;
  moderatedAt: Date | string | null;
  tags: string[];
  communityScore: number;
  totalVotes: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  otherCategoryLabel?: string | null;
  contest?: {
    id: string;
    title: string;
    status: string;
    seriesSlug?: string | null;
    cycleMonth?: string | null;
    category?: { id: string; name: string; slug: string } | null;
  } | null;
  creator?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  videoCategory?: {
    id?: string;
    name: string;
    slug?: string;
    isActive?: boolean;
  } | null;
}

export async function toPledgeVideoView(submission: PledgeSubmissionViewInput) {
  const media = await resolveSubmissionMedia(
    submission.objectKey,
    submission.videoUrl,
    submission.thumbnailUrl,
    { audience: 'restricted', expiresInSeconds: 3600 },
  );

  return {
    id: submission.id,
    domain: submission.domain,
    contestId: submission.contestId,
    creatorId: submission.creatorId,
    title: submission.title,
    description: submission.description,
    videoUrl: media.videoUrl,
    objectKey: submission.objectKey,
    thumbnailUrl: media.thumbnailUrl,
    durationSeconds: submission.durationSeconds,
    status: submission.status,
    rejectionReason: submission.rejectionReason,
    moderatedById: submission.moderatedById,
    moderatedAt: iso(submission.moderatedAt),
    tags: submission.tags,
    communityScore: submission.communityScore,
    totalVotes: submission.totalVotes,
    createdAt: iso(submission.createdAt),
    updatedAt: iso(submission.updatedAt),
    deletedAt: iso(submission.deletedAt),
    contest: submission.contest,
    creator: submission.creator
      ? {
          id: submission.creator.id,
          name: submission.creator.name,
          email: submission.creator.email,
        }
      : undefined,
    videoCategory: submission.videoCategory,
    otherCategoryLabel: submission.otherCategoryLabel,
  };
}

export class PledgeVideoService {
  private static assertAdmin(actor: ModerationActor) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenError(
        `Forbidden: User role '${actor.role}' does not have permission to manage Pledge videos`,
      );
    }
  }

  static async listVideos(actor: ModerationActor, query: ListPledgeVideosQuery) {
    this.assertAdmin(actor);

    const where: Prisma.SubmissionWhereInput = {
      domain: VideoDomain.PLEDGE,
      deletedAt: null,
    };

    if (query.status && query.status !== 'ALL') {
      where.status = query.status as SubmissionStatus;
    }

    if (query.contestId) {
      where.contestId = query.contestId;
    }

    if (query.cycleMonth) {
      where.contest = { cycleMonth: query.cycleMonth };
    }

    if (query.categoryId && query.categoryId !== 'ALL') {
      where.categoryId = query.categoryId;
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { creator: { name: { contains: term, mode: 'insensitive' } } },
        { creator: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    // Determine sort
    let orderBy: Prisma.SubmissionOrderByWithRelationInput = { createdAt: 'desc' };
    if (query.sortBy === 'urgency' || query.sortBy === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (query.sortBy === 'score') {
      orderBy = { communityScore: 'desc' };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [rows, totalFiltered, countsByStatus, totalPledge] = await Promise.all([
      prisma.submission.findMany({
        where,
        include: submissionInclude,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
      prisma.submission.groupBy({
        by: ['status'],
        where: {
          domain: VideoDomain.PLEDGE,
          deletedAt: null,
          ...(query.contestId ? { contestId: query.contestId } : {}),
          ...(query.cycleMonth ? { contest: { cycleMonth: query.cycleMonth } } : {}),
        },
        _count: { _all: true },
      }),
      prisma.submission.count({
        where: {
          domain: VideoDomain.PLEDGE,
          deletedAt: null,
          ...(query.contestId ? { contestId: query.contestId } : {}),
          ...(query.cycleMonth ? { contest: { cycleMonth: query.cycleMonth } } : {}),
        },
      }),
    ]);

    const countsMap = new Map(countsByStatus.map((c) => [c.status, c._count._all]));
    const pendingCount = countsMap.get(SubmissionStatus.PENDING_REVIEW) ?? 0;
    const approvedCount = countsMap.get(SubmissionStatus.APPROVED) ?? 0;
    const rejectedCount = countsMap.get(SubmissionStatus.REJECTED) ?? 0;
    const flaggedCount = countsMap.get(SubmissionStatus.FLAGGED) ?? 0;

    const statusCounts = {
      ALL: totalPledge,
      PENDING_REVIEW: pendingCount,
      APPROVED: approvedCount,
      REJECTED: rejectedCount,
      FLAGGED: flaggedCount,
    };

    const metrics = {
      pending: pendingCount,
      approvedToday: approvedCount,
      rejectedToday: rejectedCount,
      flagged: flaggedCount,
      total: totalPledge,
    };

    const items = await Promise.all(rows.map((row) => toPledgeVideoView(row)));

    return {
      items,
      metrics,
      statusCounts,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages: Math.ceil(totalFiltered / limit) || 1,
      },
    };
  }

  static async getMetrics(actor: ModerationActor, contestId?: string) {
    this.assertAdmin(actor);

    const countsByStatus = await prisma.submission.groupBy({
      by: ['status'],
      where: {
        domain: VideoDomain.PLEDGE,
        deletedAt: null,
        ...(contestId ? { contestId } : {}),
      },
      _count: { _all: true },
    });

    const countsMap = new Map(countsByStatus.map((c) => [c.status, c._count._all]));
    const pending = countsMap.get(SubmissionStatus.PENDING_REVIEW) ?? 0;
    const approved = countsMap.get(SubmissionStatus.APPROVED) ?? 0;
    const rejected = countsMap.get(SubmissionStatus.REJECTED) ?? 0;
    const flagged = countsMap.get(SubmissionStatus.FLAGGED) ?? 0;
    const total = pending + approved + rejected + flagged;

    return {
      pending,
      approvedToday: approved,
      rejectedToday: rejected,
      flagged,
      total,
      statusCounts: {
        ALL: total,
        PENDING_REVIEW: pending,
        APPROVED: approved,
        REJECTED: rejected,
        FLAGGED: flagged,
      },
    };
  }

  static async getVideoById(actor: ModerationActor, id: string) {
    this.assertAdmin(actor);

    const submission = await prisma.submission.findUnique({
      where: { id },
      include: submissionInclude,
    });

    if (!submission || submission.domain !== VideoDomain.PLEDGE) {
      throw new NotFoundError('Pledge video not found');
    }

    return toPledgeVideoView(submission);
  }

  static async getPlaybackUrl(actor: ModerationActor, id: string) {
    this.assertAdmin(actor);

    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        domain: true,
        objectKey: true,
        videoUrl: true,
        thumbnailUrl: true,
      },
    });

    if (!submission || submission.domain !== VideoDomain.PLEDGE) {
      throw new NotFoundError('Pledge video not found');
    }

    const media = await resolveSubmissionMedia(
      submission.objectKey,
      submission.videoUrl,
      submission.thumbnailUrl,
      { audience: 'restricted', expiresInSeconds: 3600 },
    );

    return {
      id: submission.id,
      videoUrl: media.videoUrl,
      thumbnailUrl: media.thumbnailUrl,
      playbackUrl: media.videoUrl,
    };
  }

  static async approveVideo(actor: ModerationActor, id: string, note?: string) {
    this.assertAdmin(actor);
    const { submission } = await ModerationService.approve(
      actor,
      id,
      note,
      VideoDomain.PLEDGE,
    );
    return toPledgeVideoView(submission);
  }

  static async rejectVideo(
    actor: ModerationActor,
    id: string,
    reason: string,
    reasonCode?: string,
  ) {
    this.assertAdmin(actor);
    const { submission } = await ModerationService.reject(
      actor,
      id,
      reason,
      reasonCode,
      VideoDomain.PLEDGE,
    );
    return toPledgeVideoView(submission);
  }

  static async listAuditLogs(actor: ModerationActor, contestId?: string) {
    this.assertAdmin(actor);
    return ModerationService.listAuditLogs(actor, {
      contestId,
      domain: VideoDomain.PLEDGE,
    });
  }
}
