import {
  AccountStatus,
  CreatorActivityAction,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { AdminCreatorRepository } from '../repositories/admin-creator.repository.js';
import { ContestRepository } from '../repositories/contest.repository.js';
import { CreatorActivityRepository } from '../repositories/creator-activity.repository.js';
import { CreatorWarningRepository } from '../repositories/creator-warning.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { buildPaginationMeta, parsePaginationParams } from '../utils/pagination.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/response.js';
import { CreatorActivityService } from './creator-activity.service.js';
import { playbackUrlForSubmission, signedAvatarUrl } from './storage.service.js';

/**
 * Admin directory of creator accounts, participation, warnings, and videos.
 *
 * ADMIN only. Participation is derived from submissions.
 * There is no separate creator-contest membership.
 * Delete removes the submission row. Ratings and comments cascade.
 * The creator account, contest, and other submissions stay.
 * The stored S3 object is not deleted: the storage port has no delete
 * operation, and this service does not invent one.
 *
 * Pending videos are PENDING_REVIEW.
 * Flagged videos stay a separate count. underModerationVideos is
 * PENDING_REVIEW + FLAGGED for the "pending / under moderation" summary.
 * totalRatingsReceived is the sum of submission.totalVotes.
 */

export interface AdminActor {
  id: string;
  role: Role;
}

export interface CreatorListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AccountStatus;
  contestId?: string;
}

const EMPTY_VIDEO_COUNTS = {
  totalVideos: 0,
  approvedVideos: 0,
  pendingVideos: 0,
  rejectedVideos: 0,
  flaggedVideos: 0,
};

function assertAdmin(actor: AdminActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError(
      `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
    );
  }
}

function videoCounts() {
  return { ...EMPTY_VIDEO_COUNTS };
}

function applyStatusCount(
  counts: ReturnType<typeof videoCounts>,
  status: SubmissionStatus,
  amount: number,
) {
  counts.totalVideos += amount;
  if (status === SubmissionStatus.APPROVED) counts.approvedVideos += amount;
  else if (status === SubmissionStatus.PENDING_REVIEW) counts.pendingVideos += amount;
  else if (status === SubmissionStatus.REJECTED) counts.rejectedVideos += amount;
  else if (status === SubmissionStatus.FLAGGED) counts.flaggedVideos += amount;
}

async function toVideo<
  T extends {
    id: string;
    title: string;
    status: SubmissionStatus;
    createdAt: Date;
    updatedAt: Date;
    contestId: string;
    communityScore: number;
    totalVotes: number;
    durationSeconds?: number;
    objectKey?: string;
    videoUrl?: string;
    contest: { title: string; status: string };
  },
>(submission: T, withPlayback: boolean) {
  return {
    id: submission.id,
    title: submission.title,
    status: submission.status,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    contestId: submission.contestId,
    contestTitle: submission.contest.title,
    contestStatus: submission.contest.status,
    communityScore: submission.communityScore,
    totalVotes: submission.totalVotes,
    durationSeconds: submission.durationSeconds ?? null,
    videoUrl:
      withPlayback && submission.objectKey && submission.videoUrl
        ? await playbackUrlForSubmission(submission.objectKey, submission.videoUrl)
        : null,
  };
}

export class AdminCreatorService {
  static async list(actor: AdminActor, query: CreatorListQuery = {}) {
    assertAdmin(actor);
    const { page, limit, skip } = parsePaginationParams({
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    const search = query.search?.trim() || undefined;
    const [summary, pageResult] = await Promise.all([
      AdminCreatorRepository.summary(),
      AdminCreatorRepository.searchCreators({
        skip,
        limit,
        search,
        status: query.status,
        contestId: query.contestId,
      }),
    ]);

    const ids = pageResult.users.map((user) => user.id);
    const [stats, activity] = await Promise.all([
      AdminCreatorRepository.submissionStatsForCreators(ids),
      CreatorActivityRepository.latestForCreators(ids),
    ]);

    const counts = new Map<string, ReturnType<typeof videoCounts>>();
    for (const row of stats.byStatus) {
      const current = counts.get(row.creatorId) ?? videoCounts();
      applyStatusCount(current, row.status, row._count._all);
      counts.set(row.creatorId, current);
    }
    const contests = new Map<string, number>();
    for (const row of stats.byContest) {
      contests.set(row.creatorId, (contests.get(row.creatorId) ?? 0) + 1);
    }
    const lastActivity = new Map(
      activity.map((row) => [row.creatorId, row._max.createdAt]),
    );

    const creators = pageResult.users.map((user) => {
      const video = counts.get(user.id) ?? videoCounts();
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
        lastActivityAt: lastActivity.get(user.id) ?? null,
        ...video,
        contestsParticipated: contests.get(user.id) ?? 0,
        submissionCount: video.totalVideos,
      };
    });

    return {
      totalCreators: summary.totalCreators,
      summary,
      creators,
      pagination: buildPaginationMeta(pageResult.totalCount, page, limit),
    };
  }

  static async getProfile(actor: AdminActor, creatorId: string) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) {
      throw new NotFoundError('Creator not found');
    }

    const [stats, warnings, latest, submissions] = await Promise.all([
      AdminCreatorRepository.creatorStats(creatorId),
      CreatorWarningRepository.listByCreator(creatorId),
      CreatorActivityRepository.findLatest(creatorId),
      SubmissionRepository.listByCreatorId(creatorId),
    ]);

    const counts = videoCounts();
    for (const row of stats.byStatus) {
      applyStatusCount(counts, row.status, row._count._all);
    }

    const videos = await Promise.all(
      submissions.map((submission) => toVideo(submission, true)),
    );
    const avatarUrl = await signedAvatarUrl(creator.avatarObjectKey);

    return {
      creator: {
        id: creator.id,
        name: creator.name,
        email: creator.email,
        role: creator.role,
        accountStatus: creator.accountStatus,
        createdAt: creator.createdAt,
        lastActivityAt: latest?.createdAt ?? null,
        ...(avatarUrl ? { avatarUrl } : {}),
      },
      stats: {
        ...counts,
        underModerationVideos: counts.pendingVideos + counts.flaggedVideos,
        contestsParticipated: stats.contestCount,
        totalRatingsReceived: stats.ratings._sum.totalVotes ?? 0,
        totalComments: stats.comments,
      },
      warnings: warnings.map((warning) => ({
        id: warning.id,
        reason: warning.reason,
        createdAt: warning.createdAt,
        issuedBy: warning.issuedBy,
      })),
      submissions: videos,
    };
  }

  static async listContests(actor: AdminActor, creatorId: string) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) throw new NotFoundError('Creator not found');

    const rows = await SubmissionRepository.listCreatorParticipation(creatorId);
    const grouped = new Map<
      string,
      {
        contestId: string;
        title: string;
        status: string;
        submissionCount: number;
        firstSubmissionAt: Date;
        latestSubmissionAt: Date;
        submissions: Array<{
          id: string;
          title: string;
          status: SubmissionStatus;
          createdAt: Date;
          updatedAt: Date;
          communityScore: number;
          totalVotes: number;
        }>;
      }
    >();

    for (const row of rows) {
      let contest = grouped.get(row.contestId);
      if (!contest) {
        contest = {
          contestId: row.contestId,
          title: row.contest.title,
          status: row.contest.status,
          submissionCount: 0,
          firstSubmissionAt: row.createdAt,
          latestSubmissionAt: row.createdAt,
          submissions: [],
        };
        grouped.set(row.contestId, contest);
      }
      contest.submissionCount += 1;
      if (row.createdAt < contest.firstSubmissionAt)
        contest.firstSubmissionAt = row.createdAt;
      if (row.createdAt > contest.latestSubmissionAt)
        contest.latestSubmissionAt = row.createdAt;
      contest.submissions.push({
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        communityScore: row.communityScore,
        totalVotes: row.totalVotes,
      });
    }

    return {
      creatorId,
      contests: [...grouped.values()].sort(
        (a, b) => b.latestSubmissionAt.getTime() - a.latestSubmissionAt.getTime(),
      ),
    };
  }

  static async listSubmissions(
    actor: AdminActor,
    creatorId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) throw new NotFoundError('Creator not found');
    const { page, limit, skip } = parsePaginationParams(query);
    const { rows, totalCount } = await SubmissionRepository.pageByCreator(
      creatorId,
      skip,
      limit,
    );
    const items = await Promise.all(rows.map((row) => toVideo(row, true)));
    return {
      items,
      pagination: buildPaginationMeta(totalCount, page, limit),
    };
  }

  static async listActivity(
    actor: AdminActor,
    creatorId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) throw new NotFoundError('Creator not found');
    const { page, limit, skip } = parsePaginationParams(query);
    const { rows, totalCount } = await CreatorActivityRepository.pageByCreator(
      creatorId,
      skip,
      limit,
    );

    const submissionIds = [
      ...new Set(
        rows.map((row) => row.relatedSubmissionId).filter((id): id is string => !!id),
      ),
    ];
    const contestIds = [
      ...new Set(
        rows.map((row) => row.relatedContestId).filter((id): id is string => !!id),
      ),
    ];

    const [submissions, contests] = await Promise.all([
      submissionIds.length
        ? SubmissionRepository.findTitlesByIds(submissionIds)
        : Promise.resolve([]),
      contestIds.length
        ? ContestRepository.findTitlesByIds(contestIds)
        : Promise.resolve([]),
    ]);
    const submissionTitles = new Map(submissions.map((row) => [row.id, row.title]));
    const contestTitles = new Map(contests.map((row) => [row.id, row.title]));

    return {
      items: rows.map((row) => {
        const metadata =
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {};
        const storedSubmissionTitle =
          typeof metadata.submissionTitle === 'string' ? metadata.submissionTitle : null;
        const storedContestTitle =
          typeof metadata.contestTitle === 'string' ? metadata.contestTitle : null;
        return {
          id: row.id,
          action: row.action,
          description: row.description,
          relatedSubmissionId: row.relatedSubmissionId,
          relatedContestId: row.relatedContestId,
          relatedSubmissionTitle: row.relatedSubmissionId
            ? (submissionTitles.get(row.relatedSubmissionId) ?? storedSubmissionTitle)
            : storedSubmissionTitle,
          relatedContestTitle: row.relatedContestId
            ? (contestTitles.get(row.relatedContestId) ?? storedContestTitle)
            : storedContestTitle,
          performedBy: row.performedBy
            ? {
                id: row.performedBy.id,
                name: row.performedBy.name,
                email: row.performedBy.email,
                role: row.performedBy.role,
              }
            : null,
          createdAt: row.createdAt,
        };
      }),
      pagination: buildPaginationMeta(totalCount, page, limit),
    };
  }

  static async warn(actor: AdminActor, creatorId: string, reason: string) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) throw new NotFoundError('Creator not found');
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new ValidationError('Warning reason is required');
    }
    const warning = await CreatorWarningRepository.create({
      creatorId,
      issuedById: actor.id,
      reason: trimmed,
    });
    await CreatorActivityService.record({
      creatorId,
      action: CreatorActivityAction.WARNED,
      description: 'Creator warned',
      performedByUserId: actor.id,
      metadata: { warningId: warning.id },
    });
    return {
      id: warning.id,
      creatorId: warning.creatorId,
      reason: warning.reason,
      createdAt: warning.createdAt,
      issuedBy: warning.issuedBy,
    };
  }

  static async setStatus(
    actor: AdminActor,
    creatorId: string,
    accountStatus: AccountStatus,
  ) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) throw new NotFoundError('Creator not found');
    if (creator.role !== Role.CREATOR) {
      throw new ForbiddenError(
        'Admin accounts cannot be blocked through creator management',
      );
    }
    if (creator.accountStatus === accountStatus) {
      return {
        id: creator.id,
        accountStatus: creator.accountStatus,
        changed: false,
      };
    }
    const updated = await UserRepository.updateAccountStatus(creatorId, accountStatus);
    await CreatorActivityService.record({
      creatorId,
      action:
        accountStatus === AccountStatus.BLOCKED
          ? CreatorActivityAction.BLOCKED
          : CreatorActivityAction.UNBLOCKED,
      description:
        accountStatus === AccountStatus.BLOCKED ? 'Creator blocked' : 'Creator unblocked',
      performedByUserId: actor.id,
    });
    return {
      id: updated.id,
      accountStatus: updated.accountStatus,
      changed: true,
    };
  }

  static async contestParticipants(
    actor: AdminActor,
    contestId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    assertAdmin(actor);
    const contest = await ContestRepository.findById(contestId);
    if (!contest) throw new NotFoundError('Contest not found');
    const { page, limit, skip } = parsePaginationParams(query);
    const [participatingCreatorCount, pageResult] = await Promise.all([
      AdminCreatorRepository.countContestParticipants(contestId),
      AdminCreatorRepository.pageContestParticipants(contestId, skip, limit),
    ]);
    const creatorsById = new Map(
      pageResult.creators.map((creator) => [creator.id, creator]),
    );
    const submissionsByCreator = new Map<string, typeof pageResult.submissions>();
    for (const submission of pageResult.submissions) {
      const list = submissionsByCreator.get(submission.creatorId) ?? [];
      list.push(submission);
      submissionsByCreator.set(submission.creatorId, list);
    }

    return {
      contest: {
        id: contest.id,
        title: contest.title,
        status: contest.status,
      },
      participatingCreatorCount,
      creators: pageResult.groups.map((group) => {
        const creator = creatorsById.get(group.creatorId);
        return {
          id: group.creatorId,
          name: creator?.name ?? 'Unknown creator',
          email: creator?.email ?? '',
          accountStatus: creator?.accountStatus ?? AccountStatus.ACTIVE,
          submissionCount: group._count._all,
          firstSubmissionAt: group._min.createdAt,
          latestSubmissionAt: group._max.createdAt,
          submissions: (submissionsByCreator.get(group.creatorId) ?? []).map(
            (submission) => ({
              id: submission.id,
              title: submission.title,
              status: submission.status,
              createdAt: submission.createdAt,
              updatedAt: submission.updatedAt,
              communityScore: submission.communityScore,
              totalVotes: submission.totalVotes,
            }),
          ),
        };
      }),
      pagination: buildPaginationMeta(participatingCreatorCount, page, limit),
    };
  }

  static async deleteSubmission(actor: AdminActor, submissionId: string) {
    assertAdmin(actor);
    const existing = await SubmissionRepository.findById(submissionId);
    if (!existing) {
      throw new NotFoundError('Submission not found');
    }
    await SubmissionRepository.deleteById(submissionId);
    if (existing.creatorId) {
      await CreatorActivityService.record({
        creatorId: existing.creatorId,
        action: CreatorActivityAction.SUBMISSION_DELETED,
        description: 'Submission deleted',
        relatedSubmissionId: existing.id,
        relatedContestId: existing.contestId,
        performedByUserId: actor.id,
        metadata: {
          submissionTitle: existing.title,
          contestTitle: existing.contest?.title ?? '',
        },
      });
    }
    return {
      id: submissionId,
      deleted: true,
      mediaObjectRetained: true,
    };
  }
}
