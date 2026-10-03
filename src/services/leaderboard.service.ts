import { ContestStatus } from '@prisma/client';
import { ContestRepository } from '../repositories/contest.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { playbackUrlForSubmission } from './storage.service.js';
import { NotFoundError } from '../utils/response.js';

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
  };
}

export interface ContestLeaderboardView {
  contest: {
    id: string;
    title: string;
    status: ContestStatus;
    category?: {
      id: string;
      name: string;
      slug: string;
    } | null;
  };
  totalEntries: number;
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

    const items: LeaderboardItemView[] = await Promise.all(
      rawSubmissions.map(async (record, index) => ({
        rank: index + 1,
        id: record.id,
        contestId: record.contestId,
        contestTitle: record.contest.title,
        title: record.title,
        description: record.description,
        videoUrl: await playbackUrlForSubmission(record.objectKey, record.videoUrl, {
          audience: 'public',
        }),
        thumbnailUrl: record.thumbnailUrl,
        durationSeconds: record.durationSeconds,
        tags: record.tags,
        communityScore: record.communityScore,
        totalVotes: record.totalVotes,
        createdAt: record.createdAt.toISOString(),
        creator: {
          id: record.creator.id,
          name: record.creator.name,
        },
      })),
    );

    const totalEntries = items.length;
    const totalVotes = items.reduce((sum, item) => sum + item.totalVotes, 0);
    const sumScore = items.reduce((sum, item) => sum + item.communityScore, 0);
    const averageScore =
      totalEntries > 0 ? Math.round((sumScore / totalEntries) * 10) / 10 : 0;
    const podium = items.slice(0, 3);

    return {
      contest: {
        id: contest.id,
        title: contest.title,
        status: contest.status,
        category: contest.category
          ? {
              id: contest.category.id,
              name: contest.category.name,
              slug: contest.category.slug,
            }
          : null,
      },
      totalEntries,
      totalVotes,
      averageScore,
      items,
      podium,
    };
  }
}
