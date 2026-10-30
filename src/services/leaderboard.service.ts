import { ContestStatus } from '@prisma/client';
import { ContestRepository } from '../repositories/contest.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import {
  playbackUrlForSubmission,
  resolveContestBannerUrl,
  signedAvatarUrl,
  resolveThumbnailUrl,
} from './storage.service.js';
import { DEFAULT_CONTEST_TIMEZONE } from './contest-schedule.js';
import { NotFoundError } from '../utils/response.js';
import { RatingRepository } from '../repositories/rating.repository.js';
import { pledgeLeaderboardPartition } from './pledge-finalization.service.js';
import { PLEDGE_SERIES_SLUG } from './contest-schedule.js';

export interface LeaderboardItemView {
  rank: number;
  id: string;
  contestId: string;
  contestTitle: string;
  title: string;
  description: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  tags: string[];
  communityScore: number;
  totalVotes: number;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  distinctVoterCount?: number;
  isQuorumQualified?: boolean;
  requiredVoterCount?: number;
  quorumProgress?: string;
}

export interface ContestLeaderboardView {
  contest: {
    id: string;
    title: string;
    description: string;
    tagline: string | null;
    bannerUrl: string | null;
    status: ContestStatus;
    timezone: string;
    startDate: string;
    endDate: string;
    votingClosesAt: string | null;
    prizeSummary: string | null;
    category?: {
      id: string;
      name: string;
      slug: string;
    } | null;
  };
  totalEntries: number;
  totalParticipants: number;
  totalVotes: number;
  averageScore: number;
  items: LeaderboardItemView[];
  podium: LeaderboardItemView[];
}

export interface GetLeaderboardOptions {
  category?: string;
  timeframe?: string;
}

/**
 * Leaderboard domain service (M09-P01-T01).
 *
 * Rules implemented:
 * - BR-WIN-01: Ranked in descending order of communityScore (totalVotes breaks ties).
 * - BR-WIN-02: Only APPROVED submissions participate. REJECTED, PENDING_REVIEW, FLAGGED excluded.
 * - BR-WIN-03: Final rankings become official upon contest closure (read-only for COMPLETED/ARCHIVED).
 * - Timeframe aggregation: NOT SPECIFIED in source documentation (documented per M09-P01-T03).
 */
export class LeaderboardService {
  static async getContestLeaderboard(
    contestId: string,
    options: GetLeaderboardOptions = {},
  ): Promise<ContestLeaderboardView> {
    const contest = await ContestRepository.findById(contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }

    const rawSubmissions = await SubmissionRepository.listLeaderboardForContest(
      contestId,
      options.category,
    );
    const categoryScoped = Boolean(options.category && options.category !== 'ALL');
    const quorum =
      contest.seriesSlug === PLEDGE_SERIES_SLUG
        ? pledgeLeaderboardPartition(
            rawSubmissions.map((record) => ({
              id: record.id,
              communityScore: record.communityScore,
              categoryName: record.contest.category?.name ?? null,
            })),
            await RatingRepository.listVoterRows(contestId),
            {
              categoryScoped,
              minOverallVoters: contest.minOverallVoters,
              minCategoryVoters: contest.minCategoryVoters,
            },
          )
        : null;
    const quorumById = new Map(
      [...(quorum?.qualified ?? []), ...(quorum?.pending ?? [])].map((row) => [
        row.id,
        row,
      ]),
    );
    if (quorum) {
      quorum.qualified.sort(
        (a, b) =>
          b.communityScore - a.communityScore ||
          b.distinctVoterCount - a.distinctVoterCount ||
          a.id.localeCompare(b.id),
      );
    }
    const ordered = quorum
      ? [...quorum.qualified, ...quorum.pending].flatMap((row) => {
          const record = rawSubmissions.find((submission) => submission.id === row.id);
          return record ? [record] : [];
        })
      : rawSubmissions;

    const items: LeaderboardItemView[] = await Promise.all(
      ordered.map(async (record, index) => {
        const qualification = quorumById.get(record.id);
        const qualifiedIndex = quorum
          ? quorum.qualified.findIndex((row) => row.id === record.id)
          : index;
        return {
          rank:
            qualification && !qualification.isQuorumQualified ? 0 : qualifiedIndex + 1,
          id: record.id,
          contestId: record.contestId,
          contestTitle: record.contest.title,
          title: record.title,
          description: record.description,
          videoUrl: await playbackUrlForSubmission(record.objectKey, record.videoUrl, {
            audience: 'public',
          }),
          thumbnailUrl: await resolveThumbnailUrl(record.thumbnailUrl, {
            audience: 'public',
          }),
          durationSeconds: record.durationSeconds,
          tags: record.tags,
          communityScore: record.communityScore,
          totalVotes: record.totalVotes,
          createdAt: record.createdAt.toISOString(),
          creator: {
            id: record.creator.id,
            name: record.creator.name,
            avatarUrl: await signedAvatarUrl(record.creator.avatarObjectKey),
          },
          ...(qualification
            ? {
                distinctVoterCount: qualification.distinctVoterCount,
                isQuorumQualified: qualification.isQuorumQualified,
                requiredVoterCount: qualification.requiredVoterCount,
                quorumProgress: qualification.quorumProgress,
              }
            : {}),
        };
      }),
    );

    const totalEntries = items.length;
    const totalParticipants = new Set(items.map((item) => item.creator.id)).size;
    const totalVotes = items.reduce((sum, item) => sum + item.totalVotes, 0);
    const sumScore = items.reduce((sum, item) => sum + item.communityScore, 0);
    const averageScore =
      totalEntries > 0 ? Math.round((sumScore / totalEntries) * 10) / 10 : 0;
    const podium = (
      quorum ? items.filter((item) => item.isQuorumQualified) : items
    ).slice(0, 3);

    return {
      contest: {
        id: contest.id,
        title: contest.title,
        description: contest.description,
        tagline: contest.tagline,
        bannerUrl: await resolveContestBannerUrl(
          contest.bannerObjectKey,
          contest.bannerUrl,
        ),
        status: contest.status,
        timezone: contest.timezone || DEFAULT_CONTEST_TIMEZONE,
        startDate: contest.startDate.toISOString(),
        endDate: contest.endDate.toISOString(),
        votingClosesAt: contest.votingClosesAt
          ? contest.votingClosesAt.toISOString()
          : null,
        prizeSummary: contest.prizeSummary,
        category: contest.category
          ? {
              id: contest.category.id,
              name: contest.category.name,
              slug: contest.category.slug,
            }
          : null,
      },
      totalEntries,
      totalParticipants,
      totalVotes,
      averageScore,
      items,
      podium,
    };
  }
}
