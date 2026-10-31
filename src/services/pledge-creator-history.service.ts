import { ContestStatus, Role } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ForbiddenError } from '../utils/response.js';
import { PLEDGE_SERIES_SLUG } from './contest-schedule.js';
import {
  arithmeticMean,
  categoryAverage,
  categoryScoreMap,
  enabledCategories,
  parseStoredCategories,
} from './pledge-categories.js';
import {
  cycleMonthName,
  insufficientResultMessage,
  nonWinnerResultMessage,
} from './pledge-cycle-config.js';
import { countDistinctVoters, isCountableRating } from './voter-quorum.js';
import type { WinnerSnapshot } from './pledge-finalization.service.js';

/**
 * Creator Pledge history. Ordinary contests and One Toke reviews are excluded.
 * Unpublished team selections are not described as a loss.
 */

export interface PledgeHistoryActor {
  id: string;
  role: Role;
}

function snapshotOf(value: unknown): WinnerSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as WinnerSnapshot;
  if (!snapshot.overall || !snapshot.cycleMonth) return null;
  return snapshot;
}

function publishedResult(status: ContestStatus, value: unknown): WinnerSnapshot | null {
  if (status !== ContestStatus.COMPLETED) return null;
  const snapshot = snapshotOf(value);
  if (!snapshot || snapshot.published === false) return null;
  return snapshot;
}

export interface PledgeHistoryEntry {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  submittedAt: string;
  moderationStatus: string;
  rejectionReason: string | null;
  overallAverage: number | null;
  overallRatingCount: number;
  insufficientSample: boolean;
  categoryRatings: Array<{
    slug: string;
    name: string;
    average: number | null;
    count: number;
    insufficientSample: boolean;
  }>;
  finalRank: number | null;
  winner: boolean;
  resultState: 'winner' | 'not-selected' | 'pending' | 'rejected' | 'insufficient';
  resultMessage: string | null;
  resultsPending: boolean;
  archivePath: string | null;
}

export interface PledgeHistoryMonth {
  cycleMonth: string;
  monthLabel: string;
  contestId: string;
  contestTitle: string;
  contestStatus: ContestStatus;
  resultsPublished: boolean;
  entries: PledgeHistoryEntry[];
}

export class PledgeCreatorHistoryService {
  static async listMine(actor: PledgeHistoryActor) {
    if (actor.role !== Role.CREATOR) {
      throw new ForbiddenError(
        'Forbidden: User role does not have permission to access this resource',
      );
    }
    const rows = await prisma.submission.findMany({
      where: {
        creatorId: actor.id,
        deletedAt: null,
        contest: { seriesSlug: PLEDGE_SERIES_SLUG, cycleMonth: { not: null } },
      },
      include: {
        contest: true,
        ratings: {
          select: {
            rating: true,
            categoryScores: true,
            userId: true,
            guestVoterId: true,
          },
        },
      },
      orderBy: [{ contest: { cycleMonth: 'desc' } }, { createdAt: 'desc' }],
    });

    const months = new Map<string, PledgeHistoryMonth>();

    for (const row of rows) {
      const cycleMonth = row.contest.cycleMonth ?? '';
      const published = publishedResult(row.contest.status, row.contest.winnersData);
      const countable = row.ratings.filter((rating) =>
        isCountableRating({
          submissionId: row.id,
          userId: rating.userId,
          guestVoterId: rating.guestVoterId,
          rating: rating.rating,
          categoryScores: rating.categoryScores,
          creatorId: row.creatorId,
          submissionStatus: row.status,
          deleted: false,
        }),
      );
      const voterRows = countable.map((rating) => ({
        submissionId: row.id,
        userId: rating.userId,
        guestVoterId: rating.guestVoterId,
        rating: rating.rating,
        categoryScores: rating.categoryScores,
        creatorId: row.creatorId,
        submissionStatus: row.status,
        deleted: false,
      }));
      const overallCount = countDistinctVoters(voterRows, row.id);
      const quorumMet = overallCount >= row.contest.minOverallVoters;
      const overallAverage = quorumMet
        ? arithmeticMean(countable.map((rating) => rating.rating))
        : null;
      const categories = enabledCategories(
        parseStoredCategories(row.contest.scoringCategories),
      );
      const maps = countable.map((rating) => categoryScoreMap(rating.categoryScores));
      const categoryRatings = categories.map((category) => {
        const stats = categoryAverage(maps, category.slug);
        const enough =
          stats.count >= row.contest.minCategoryVoters && stats.average != null;
        return {
          slug: category.slug,
          name: category.name,
          average: enough ? stats.average : null,
          count: stats.count,
          insufficientSample: !enough,
        };
      });
      const winnerIndex = published
        ? published.overall.winners.findIndex((winner) => winner.submissionId === row.id)
        : -1;
      const isWinner = winnerIndex >= 0;
      const rejected = row.status === 'REJECTED';
      let resultState:
        'winner' | 'not-selected' | 'pending' | 'rejected' | 'insufficient' = 'pending';
      let resultMessage: string | null = null;
      if (rejected) {
        resultState = 'rejected';
      } else if (!published) {
        resultState = 'pending';
        resultMessage = 'Results pending';
      } else if (isWinner) {
        resultState = 'winner';
      } else if (!quorumMet) {
        resultState = 'insufficient';
        resultMessage = insufficientResultMessage(cycleMonth);
      } else if (overallAverage != null) {
        resultState = 'not-selected';
        resultMessage = nonWinnerResultMessage(cycleMonth, overallAverage);
      } else {
        resultState = 'pending';
        resultMessage = 'Results pending';
      }

      const entry = {
        id: row.id,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        videoUrl: row.videoUrl,
        submittedAt: row.createdAt.toISOString(),
        moderationStatus: row.status,
        rejectionReason: rejected ? row.rejectionReason : null,
        overallAverage,
        overallRatingCount: overallCount,
        insufficientSample: !rejected && published !== null && !isWinner && !quorumMet,
        categoryRatings,
        finalRank: isWinner ? winnerIndex + 1 : null,
        winner: isWinner,
        resultState,
        resultMessage,
        resultsPending: resultState === 'pending',
        archivePath: published ? `/pledge/archive/${row.contest.id}` : null,
      };

      const group = months.get(cycleMonth) ?? {
        cycleMonth,
        monthLabel: `${cycleMonthName(cycleMonth)} ${cycleMonth.slice(0, 4)}`,
        contestId: row.contest.id,
        contestTitle: row.contest.title,
        contestStatus: row.contest.status,
        resultsPublished: published !== null,
        entries: [],
      };
      group.entries.push(entry);
      months.set(cycleMonth, group);
    }

    return { months: [...months.values()] };
  }
}
