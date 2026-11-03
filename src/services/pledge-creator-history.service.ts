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
import { resolveSubmissionMedia } from './storage.service.js';
import { PledgeRecurrenceService } from './pledge-recurrence.service.js';

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
  if (status !== ContestStatus.COMPLETED && status !== ContestStatus.ARCHIVED)
    return null;
  const snapshot = snapshotOf(value);
  if (!snapshot || snapshot.published === false) return null;
  return snapshot;
}

export interface PledgeReplacedVersion {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  submittedAt: string;
  replacedAt: string | null;
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
  badge?: 'gold' | 'silver' | 'bronze' | null;
  winner: boolean;
  isNominated: boolean;
  resultState: 'winner' | 'not-selected' | 'pending' | 'rejected' | 'insufficient';
  resultMessage: string | null;
  resultsPending: boolean;
  archivePath: string | null;
  previousVersions: PledgeReplacedVersion[];
}

export interface PledgeHistoryMonth {
  cycleMonth: string;
  monthLabel: string;
  contestId: string;
  contestTitle: string;
  contestStatus: ContestStatus;
  resultsPublished: boolean;
  isCurrentMonth?: boolean;
  entries: PledgeHistoryEntry[];
}

export class PledgeCreatorHistoryService {
  static async listMine(actor: PledgeHistoryActor) {
    if (actor.role !== Role.CREATOR && actor.role !== Role.ADMIN) {
      throw new ForbiddenError(
        'Forbidden: User role does not have permission to access this resource',
      );
    }

    try {
      await PledgeRecurrenceService.ensureCurrentMonthlyContest();
    } catch {
      // Safe fallback if recurrence store is mocked or offline
    }

    // 1. Fetch all Pledge monthly cycles, newest cycleMonth first
    const cycles = await prisma.contest.findMany({
      where: { seriesSlug: PLEDGE_SERIES_SLUG, cycleMonth: { not: null } },
      orderBy: { cycleMonth: 'desc' },
    });

    // 2. Fetch all submissions belonging to this creator for Pledge contests
    // We intentionally do NOT filter out deletedAt: null so that replaced/archived versions are included.
    const allCreatorSubmissions = await prisma.submission.findMany({
      where: {
        creatorId: actor.id,
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
      orderBy: { createdAt: 'desc' },
    });

    // Determine current cycle (ACTIVE cycle or first cycle)
    const activeCycle =
      cycles.find((c) => c.status === ContestStatus.ACTIVE) ?? cycles[0];

    // Group submissions by contestId
    const submissionsByContest = new Map<string, typeof allCreatorSubmissions>();
    for (const sub of allCreatorSubmissions) {
      const list = submissionsByContest.get(sub.contestId) ?? [];
      list.push(sub);
      submissionsByContest.set(sub.contestId, list);
    }

    const months: PledgeHistoryMonth[] = [];

    // For each cycle in cycles: include it if it's the current active cycle OR if the creator has submissions in it
    for (const cycle of cycles) {
      const cycleSubs = submissionsByContest.get(cycle.id) ?? [];
      const isCurrentMonth = cycle.id === activeCycle?.id;

      // Skip past cycles where the creator never submitted
      if (!isCurrentMonth && cycleSubs.length === 0) {
        continue;
      }

      const cycleMonth = cycle.cycleMonth ?? '';
      const published = publishedResult(cycle.status, cycle.winnersData);

      const monthGroup: PledgeHistoryMonth = {
        cycleMonth,
        monthLabel: `${cycleMonthName(cycleMonth)} ${cycleMonth.slice(0, 4)}`,
        contestId: cycle.id,
        contestTitle: cycle.title,
        contestStatus: cycle.status,
        resultsPublished: published !== null,
        isCurrentMonth,
        entries: [],
      };

      if (cycleSubs.length === 0) {
        // Current cycle without submissions yet
        months.push(monthGroup);
        continue;
      }

      // Identify replaced vs active candidates:
      const isReplacedSub = (s: (typeof cycleSubs)[0]) =>
        s.deletedAt !== null ||
        (Array.isArray(s.tags) && s.tags.includes('replaced')) ||
        Boolean(s.rejectionReason?.startsWith('REPLACED_BY:'));

      const activeCandidates = cycleSubs.filter((s) => !isReplacedSub(s));

      // If published, check if one of the creator's submissions is certified as a winner
      let activeRow: (typeof cycleSubs)[0] | undefined;
      if (published) {
        activeRow = cycleSubs.find((s) =>
          published.overall.winners.some((w) => w.submissionId === s.id),
        );
      }

      // If not selected yet, pick newest active candidate (or latest submission if none)
      if (!activeRow) {
        activeRow = activeCandidates[0] ?? cycleSubs[0];
      }

      // The rest of the submissions are treated as replaced/archived versions
      const replacedSubs = cycleSubs
        .filter((s) => s.id !== activeRow!.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // Resolve secure media for active submission
      const activeMedia = await resolveSubmissionMedia(
        activeRow!.objectKey,
        activeRow!.videoUrl,
        activeRow!.thumbnailUrl,
        { audience: 'restricted' },
      );

      // Resolve secure media for replaced versions
      const previousVersions: PledgeReplacedVersion[] = await Promise.all(
        replacedSubs.map(async (v) => {
          const verMedia = await resolveSubmissionMedia(
            v.objectKey,
            v.videoUrl,
            v.thumbnailUrl,
            { audience: 'restricted' },
          );
          return {
            id: v.id,
            title: v.title,
            thumbnailUrl: verMedia.thumbnailUrl,
            videoUrl: verMedia.videoUrl,
            submittedAt: v.createdAt.toISOString(),
            replacedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
          };
        }),
      );

      const countable = activeRow!.ratings.filter((rating) =>
        isCountableRating({
          submissionId: activeRow!.id,
          userId: rating.userId,
          guestVoterId: rating.guestVoterId,
          rating: rating.rating,
          categoryScores: rating.categoryScores,
          creatorId: activeRow!.creatorId,
          submissionStatus: activeRow!.status,
          deleted: false,
        }),
      );
      const voterRows = countable.map((rating) => ({
        submissionId: activeRow!.id,
        userId: rating.userId,
        guestVoterId: rating.guestVoterId,
        rating: rating.rating,
        categoryScores: rating.categoryScores,
        creatorId: activeRow!.creatorId,
        submissionStatus: activeRow!.status,
        deleted: false,
      }));
      const overallCount = countDistinctVoters(voterRows, activeRow!.id);
      const quorumMet = overallCount >= cycle.minOverallVoters;
      const overallAverage = quorumMet
        ? arithmeticMean(countable.map((rating) => rating.rating))
        : null;
      const categories = enabledCategories(
        parseStoredCategories(cycle.scoringCategories),
      );
      const maps = countable.map((rating) => categoryScoreMap(rating.categoryScores));
      const categoryRatings = categories.map((category) => {
        const stats = categoryAverage(maps, category.slug);
        const enough = stats.count >= cycle.minCategoryVoters && stats.average != null;
        return {
          slug: category.slug,
          name: category.name,
          average: enough ? stats.average : null,
          count: stats.count,
          insufficientSample: !enough,
        };
      });
      const winnerIndex = published
        ? published.overall.winners.findIndex(
            (winner) => winner.submissionId === activeRow!.id,
          )
        : -1;
      const isWinner = winnerIndex >= 0;
      const winnerData = isWinner ? published!.overall.winners[winnerIndex] : null;
      const rejected = activeRow!.status === 'REJECTED';
      let resultState:
        'winner' | 'not-selected' | 'pending' | 'rejected' | 'insufficient' = 'pending';
      let resultMessage: string | null = null;
      if (rejected) {
        resultState = 'rejected';
        resultMessage = activeRow!.rejectionReason;
      } else if (!published) {
        resultState = 'pending';
        resultMessage = 'Results pending';
      } else if (isWinner) {
        resultState = 'winner';
        resultMessage = 'Winner Selected!';
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

      const teamEvaluations = (
        cycle.winnersData as {
          teamEvaluations?: Record<string, { nominated?: boolean }>;
        } | null
      )?.teamEvaluations;
      const isNominated = Boolean(teamEvaluations?.[activeRow!.id]?.nominated);

      const entry: PledgeHistoryEntry = {
        id: activeRow!.id,
        title: activeRow!.title,
        thumbnailUrl: activeMedia.thumbnailUrl,
        videoUrl: activeMedia.videoUrl,
        submittedAt: activeRow!.createdAt.toISOString(),
        moderationStatus: activeRow!.status,
        rejectionReason: rejected ? activeRow!.rejectionReason : null,
        overallAverage,
        overallRatingCount: overallCount,
        insufficientSample: !rejected && published !== null && !isWinner && !quorumMet,
        categoryRatings,
        finalRank: isWinner ? (winnerData?.rank ?? winnerIndex + 1) : null,
        badge: isWinner ? (winnerData?.badge ?? null) : null,
        winner: isWinner,
        isNominated,
        resultState,
        resultMessage,
        resultsPending: resultState === 'pending',
        archivePath: published ? `/pledge/archive/${cycle.id}` : null,
        previousVersions,
      };

      monthGroup.entries.push(entry);
      months.push(monthGroup);
    }

    // In case there are submissions belonging to cycles not returned in `cycles` query
    const handledContestIds = new Set(months.map((m) => m.contestId));
    for (const [contestId, cycleSubs] of submissionsByContest.entries()) {
      if (handledContestIds.has(contestId) || cycleSubs.length === 0) continue;
      const cycle = cycleSubs[0]!.contest;
      const cycleMonth = cycle.cycleMonth ?? '';
      const published = publishedResult(cycle.status, cycle.winnersData);
      const isCurrentMonth = cycle.id === activeCycle?.id;

      const isReplacedSub = (s: (typeof cycleSubs)[0]) =>
        s.deletedAt !== null ||
        (Array.isArray(s.tags) && s.tags.includes('replaced')) ||
        Boolean(s.rejectionReason?.startsWith('REPLACED_BY:'));

      const activeCandidates = cycleSubs.filter((s) => !isReplacedSub(s));
      let activeRow = published
        ? cycleSubs.find((s) =>
            published.overall.winners.some((w) => w.submissionId === s.id),
          )
        : undefined;
      if (!activeRow) {
        activeRow = activeCandidates[0] ?? cycleSubs[0];
      }

      const replacedSubs = cycleSubs
        .filter((s) => s.id !== activeRow!.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const activeMedia = await resolveSubmissionMedia(
        activeRow!.objectKey,
        activeRow!.videoUrl,
        activeRow!.thumbnailUrl,
        { audience: 'restricted' },
      );

      const previousVersions: PledgeReplacedVersion[] = await Promise.all(
        replacedSubs.map(async (v) => {
          const verMedia = await resolveSubmissionMedia(
            v.objectKey,
            v.videoUrl,
            v.thumbnailUrl,
            { audience: 'restricted' },
          );
          return {
            id: v.id,
            title: v.title,
            thumbnailUrl: verMedia.thumbnailUrl,
            videoUrl: verMedia.videoUrl,
            submittedAt: v.createdAt.toISOString(),
            replacedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
          };
        }),
      );

      const countable = activeRow!.ratings.filter((rating) =>
        isCountableRating({
          submissionId: activeRow!.id,
          userId: rating.userId,
          guestVoterId: rating.guestVoterId,
          rating: rating.rating,
          categoryScores: rating.categoryScores,
          creatorId: activeRow!.creatorId,
          submissionStatus: activeRow!.status,
          deleted: false,
        }),
      );
      const voterRows = countable.map((rating) => ({
        submissionId: activeRow!.id,
        userId: rating.userId,
        guestVoterId: rating.guestVoterId,
        rating: rating.rating,
        categoryScores: rating.categoryScores,
        creatorId: activeRow!.creatorId,
        submissionStatus: activeRow!.status,
        deleted: false,
      }));
      const overallCount = countDistinctVoters(voterRows, activeRow!.id);
      const quorumMet = overallCount >= cycle.minOverallVoters;
      const overallAverage = quorumMet
        ? arithmeticMean(countable.map((rating) => rating.rating))
        : null;
      const categories = enabledCategories(
        parseStoredCategories(cycle.scoringCategories),
      );
      const maps = countable.map((rating) => categoryScoreMap(rating.categoryScores));
      const categoryRatings = categories.map((category) => {
        const stats = categoryAverage(maps, category.slug);
        const enough = stats.count >= cycle.minCategoryVoters && stats.average != null;
        return {
          slug: category.slug,
          name: category.name,
          average: enough ? stats.average : null,
          count: stats.count,
          insufficientSample: !enough,
        };
      });

      const winnerIndex = published
        ? published.overall.winners.findIndex(
            (winner) => winner.submissionId === activeRow!.id,
          )
        : -1;
      const isWinner = winnerIndex >= 0;
      const winnerData = isWinner ? published!.overall.winners[winnerIndex] : null;
      const rejected = activeRow!.status === 'REJECTED';
      let resultState:
        'winner' | 'not-selected' | 'pending' | 'rejected' | 'insufficient' = 'pending';
      let resultMessage: string | null = null;
      if (rejected) {
        resultState = 'rejected';
        resultMessage = activeRow!.rejectionReason;
      } else if (!published) {
        resultState = 'pending';
        resultMessage = 'Results pending';
      } else if (isWinner) {
        resultState = 'winner';
        resultMessage = 'Winner Selected!';
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

      const teamEvaluations = (
        cycle.winnersData as {
          teamEvaluations?: Record<string, { nominated?: boolean }>;
        } | null
      )?.teamEvaluations;
      const isNominated = Boolean(teamEvaluations?.[activeRow!.id]?.nominated);

      months.push({
        cycleMonth,
        monthLabel: `${cycleMonthName(cycleMonth)} ${cycleMonth.slice(0, 4)}`,
        contestId: cycle.id,
        contestTitle: cycle.title,
        contestStatus: cycle.status,
        resultsPublished: published !== null,
        isCurrentMonth,
        entries: [
          {
            id: activeRow!.id,
            title: activeRow!.title,
            thumbnailUrl: activeMedia.thumbnailUrl,
            videoUrl: activeMedia.videoUrl,
            submittedAt: activeRow!.createdAt.toISOString(),
            moderationStatus: activeRow!.status,
            rejectionReason: rejected ? activeRow!.rejectionReason : null,
            overallAverage,
            overallRatingCount: overallCount,
            insufficientSample:
              !rejected && published !== null && !isWinner && !quorumMet,
            categoryRatings,
            finalRank: isWinner ? (winnerData?.rank ?? winnerIndex + 1) : null,
            badge: isWinner ? (winnerData?.badge ?? null) : null,
            winner: isWinner,
            isNominated,
            resultState,
            resultMessage,
            resultsPending: resultState === 'pending',
            archivePath: published ? `/pledge/archive/${cycle.id}` : null,
            previousVersions,
          },
        ],
      });
    }

    // Ensure months are sorted newest first
    months.sort((a, b) => b.cycleMonth.localeCompare(a.cycleMonth));

    return { months };
  }
}
