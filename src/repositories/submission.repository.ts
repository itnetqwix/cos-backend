import { ContestStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ConflictError, NotFoundError } from '../utils/response.js';

const submissionInclude = {
  contest: {
    select: {
      id: true,
      title: true,
      status: true,
      organizationId: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionInclude;

export type SubmissionRecord = Prisma.SubmissionGetPayload<{
  include: typeof submissionInclude;
}>;

const queueInclude = {
  ...submissionInclude,
  creator: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.SubmissionInclude;

export type ModerationQueueRecord = Prisma.SubmissionGetPayload<{
  include: typeof queueInclude;
}>;

const judgingInclude = {
  creator: {
    select: {
      id: true,
      name: true,
    },
  },
  contest: {
    select: {
      id: true,
      status: true,
      organizationId: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionInclude;

export type JudgingQueueRecord = Prisma.SubmissionGetPayload<{
  include: typeof judgingInclude;
}>;

const leaderboardInclude = {
  creator: {
    select: {
      id: true,
      name: true,
    },
  },
  contest: {
    select: {
      id: true,
      title: true,
      status: true,
      organizationId: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionInclude;

export type LeaderboardRecord = Prisma.SubmissionGetPayload<{
  include: typeof leaderboardInclude;
}>;

export interface CreateSubmissionData {
  contestId: string;
  creatorId: string;
  title: string;
  description: string | null;
  videoUrl: string;
  objectKey: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  tags: string[];
}

/**
 * Submission persistence (M06-P03-T01).
 * Moderation status writes go through applyDecision (M07).
 * Community score writes go through RatingRepository (M08).
 */
export class SubmissionRepository {
  static async create(data: CreateSubmissionData): Promise<SubmissionRecord> {
    return prisma.submission.create({
      data: {
        contestId: data.contestId,
        creatorId: data.creatorId,
        title: data.title,
        description: data.description,
        videoUrl: data.videoUrl,
        objectKey: data.objectKey,
        thumbnailUrl: data.thumbnailUrl,
        durationSeconds: data.durationSeconds,
        tags: data.tags,
        status: SubmissionStatus.PENDING_REVIEW,
        communityScore: 0,
        totalVotes: 0,
      },
      include: submissionInclude,
    });
  }

  static async findById(id: string): Promise<SubmissionRecord | null> {
    return prisma.submission.findUnique({
      where: { id },
      include: submissionInclude,
    });
  }

  static async findByObjectKey(objectKey: string): Promise<SubmissionRecord | null> {
    return prisma.submission.findUnique({
      where: { objectKey },
      include: submissionInclude,
    });
  }

  static async listByCreatorId(creatorId: string): Promise<SubmissionRecord[]> {
    return prisma.submission.findMany({
      where: { creatorId },
      include: submissionInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pending-review queue (M07-P02-T01).
   * organizationId undefined = all tenants (SUPER_ADMIN).
   * Oldest first. This is display order, not a moderation SLA.
   */
  static async listPendingReview(
    organizationId?: string,
  ): Promise<ModerationQueueRecord[]> {
    return prisma.submission.findMany({
      where: {
        status: SubmissionStatus.PENDING_REVIEW,
        ...(organizationId ? { contest: { organizationId } } : {}),
      },
      include: queueInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  static async applyDecision(
    id: string,
    data: {
      status: SubmissionStatus;
      rejectionReason: string | null;
      moderatedById: string;
      moderatedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<SubmissionRecord> {
    const current = await tx.submission.findUnique({
      where: { id },
      include: submissionInclude,
    });
    if (!current) {
      throw new NotFoundError('Submission not found');
    }
    if (
      current.contest.status === ContestStatus.COMPLETED ||
      current.contest.status === ContestStatus.ARCHIVED
    ) {
      throw new ConflictError('Closed contests are read-only historical records');
    }
    if (current.status !== SubmissionStatus.PENDING_REVIEW) {
      throw new ConflictError(
        `Invalid submission status transition from ${current.status}`,
      );
    }
    return tx.submission.update({
      where: { id },
      data: {
        status: data.status,
        rejectionReason: data.rejectionReason,
        moderatedById: data.moderatedById,
        moderatedAt: data.moderatedAt,
      },
      include: submissionInclude,
    });
  }

  /**
   * Judging queue source (M08-P02-T04).
   * APPROVED only. PENDING_REVIEW, REJECTED, and FLAGGED are excluded.
   * createdAt then id ascending is display order so the list is stable.
   * It is not a leaderboard ranking (M09). A business sort key is NOT SPECIFIED.
   */
  static async listApprovedForContest(contestId: string): Promise<JudgingQueueRecord[]> {
    return prisma.submission.findMany({
      where: {
        contestId,
        status: SubmissionStatus.APPROVED,
      },
      include: judgingInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Leaderboard ranking source (M09-P01-T01).
   * APPROVED only. PENDING_REVIEW, REJECTED, and FLAGGED are excluded (BR-WIN-02).
   * Sorted strictly by communityScore desc, then totalVotes desc (BR-WIN-01).
   * Deterministic id asc is technical tie-breaker only.
   */
  static async listLeaderboardForContest(
    contestId: string,
    category?: string,
  ): Promise<LeaderboardRecord[]> {
    return prisma.submission.findMany({
      where: {
        contestId,
        status: SubmissionStatus.APPROVED,
        ...(category && category !== 'ALL'
          ? {
              OR: [
                { tags: { has: category } },
                { contest: { category: { slug: category } } },
                {
                  contest: {
                    category: { name: { equals: category, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      include: leaderboardInclude,
      orderBy: [{ communityScore: 'desc' }, { totalVotes: 'desc' }, { id: 'asc' }],
    });
  }
}
