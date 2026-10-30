import { ContestStatus, Prisma } from '@prisma/client';
import { ContestRepository } from '../repositories/contest.repository.js';
import { AuditLogRepository } from '../repositories/audit-log.repository.js';
import { RatingRepository } from '../repositories/rating.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { prisma } from '../config/database.js';
import { PLEDGE_SERIES_SLUG } from './contest-schedule.js';
import {
  countDistinctVoters,
  countValidRatings,
  decideQuorum,
  type VoterRatingRow,
} from './voter-quorum.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/response.js';

/**
 * Admin certification for one Pledge month.
 *
 * AuditLog.action has no winner-certification value, and submissionId is the
 * moderation subject. Correction history is stored on winnersData.revisions.
 * An AuditLog row is not written, because reusing APPROVE/FLAG would look
 * like a moderation decision.
 */

export interface PledgeCandidate {
  submissionId: string;
  creatorId: string;
  creatorName: string;
  title: string;
  videoUrl: string;
  categoryName: string | null;
  communityScore: number;
  distinctVoterCount: number;
  validRatingCount: number;
}

export interface WinnerSlot {
  submissionId: string;
  creatorId: string;
  creatorName: string;
  title: string;
  videoUrl: string;
  communityScore: number;
  distinctVoterCount: number;
  validRatingCount: number;
  coWinner: boolean;
}

export interface WinnerSnapshot {
  contestId: string;
  seriesSlug: string;
  cycleMonth: string;
  finalizedAt: string;
  finalizedById: string;
  certificationStatus: 'certified' | 'corrected';
  version: number;
  thresholds: { overallVoters: number; categoryRatings: number };
  categoryNames: string[];
  overall: {
    result: 'winners' | 'no-eligible-winner';
    message: string | null;
    winners: WinnerSlot[];
    tiedCandidates: WinnerSlot[];
  };
  categories: Array<{
    categoryName: string;
    result: 'winners' | 'no-eligible-winner';
    message: string | null;
    winners: WinnerSlot[];
  }>;
  revisions: Array<{
    version: number;
    at: string;
    adminId: string;
    reason: string | null;
    previous: WinnerSnapshot | null;
  }>;
}

export interface FinalizableContest {
  id: string;
  seriesSlug: string | null;
  cycleMonth: string | null;
  status: ContestStatus;
  votingClosesAt: Date | null;
  minOverallVoters: number;
  minCategoryVoters: number;
  isWinnersFinalized: boolean;
  winnersData: WinnerSnapshot | null;
  categoryName: string | null;
}

function slot(candidate: PledgeCandidate, coWinner: boolean): WinnerSlot {
  return {
    submissionId: candidate.submissionId,
    creatorId: candidate.creatorId,
    creatorName: candidate.creatorName,
    title: candidate.title,
    videoUrl: candidate.videoUrl,
    communityScore: candidate.communityScore,
    distinctVoterCount: candidate.distinctVoterCount,
    validRatingCount: candidate.validRatingCount,
    coWinner,
  };
}

/** Score, then distinct voters. Id is not a tie break. */
export function tiedLeaders(candidates: PledgeCandidate[]): PledgeCandidate[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) => {
    if (a.communityScore !== b.communityScore) return b.communityScore - a.communityScore;
    return b.distinctVoterCount - a.distinctVoterCount;
  });
  const top = sorted[0];
  if (!top) return [];
  return sorted.filter(
    (candidate) =>
      candidate.communityScore === top.communityScore &&
      candidate.distinctVoterCount === top.distinctVoterCount,
  );
}

export function assertPledgeFinalizable(contest: FinalizableContest, now: Date): void {
  if (contest.seriesSlug !== PLEDGE_SERIES_SLUG || !contest.cycleMonth) {
    throw new ConflictError('Only a Pledge monthly contest can be finalized');
  }
  if (
    contest.status !== ContestStatus.JUDGING &&
    contest.status !== ContestStatus.COMPLETED
  ) {
    throw new ConflictError('Voting must be closed before winners are certified');
  }
  if (!contest.votingClosesAt || contest.votingClosesAt.getTime() > now.getTime()) {
    throw new ConflictError('Voting must be closed before winners are certified');
  }
  if (contest.isWinnersFinalized) {
    throw new ConflictError(
      'Winners are already certified. Use correct-winner to revise them.',
    );
  }
}

export function buildWinnerSnapshot(input: {
  contest: FinalizableContest;
  candidates: PledgeCandidate[];
  adminId: string;
  now: Date;
  acceptTies: boolean;
}): { snapshot: WinnerSnapshot; tiePending: PledgeCandidate[] } {
  const overallEligible = input.candidates.filter(
    (candidate) => candidate.distinctVoterCount >= input.contest.minOverallVoters,
  );
  const leaders = tiedLeaders(overallEligible);
  const tiePending = leaders.length > 1 && !input.acceptTies ? leaders : [];
  const overallWinners = leaders.length > 1 && !input.acceptTies ? [] : leaders;
  const categoryNames = [
    ...new Set(
      input.candidates
        .map((candidate) => candidate.categoryName)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const categories = categoryNames.map((categoryName) => {
    const eligible = input.candidates.filter(
      (candidate) =>
        candidate.categoryName === categoryName &&
        candidate.validRatingCount >= input.contest.minCategoryVoters,
    );
    const categoryLeaders = tiedLeaders(eligible);
    const blocked = categoryLeaders.length > 1 && !input.acceptTies;
    return {
      categoryName,
      result:
        !blocked && categoryLeaders.length > 0
          ? ('winners' as const)
          : ('no-eligible-winner' as const),
      message:
        categoryLeaders.length === 0
          ? 'No eligible winner this month'
          : blocked
            ? 'Tie requires admin certification'
            : null,
      winners: blocked
        ? []
        : categoryLeaders.map((candidate) => slot(candidate, categoryLeaders.length > 1)),
    };
  });

  const snapshot: WinnerSnapshot = {
    contestId: input.contest.id,
    seriesSlug: PLEDGE_SERIES_SLUG,
    cycleMonth: input.contest.cycleMonth ?? '',
    finalizedAt: input.now.toISOString(),
    finalizedById: input.adminId,
    certificationStatus: 'certified',
    version: 1,
    thresholds: {
      overallVoters: input.contest.minOverallVoters,
      categoryRatings: input.contest.minCategoryVoters,
    },
    categoryNames:
      categoryNames.length > 0
        ? categoryNames
        : input.contest.categoryName
          ? [input.contest.categoryName]
          : [],
    overall: {
      result: overallWinners.length > 0 ? 'winners' : 'no-eligible-winner',
      message: overallWinners.length > 0 ? null : 'No eligible winner this month',
      winners: overallWinners.map((candidate) =>
        slot(candidate, overallWinners.length > 1),
      ),
      tiedCandidates:
        leaders.length > 1 ? leaders.map((candidate) => slot(candidate, true)) : [],
    },
    categories,
    revisions: [],
  };
  return { snapshot, tiePending };
}

export function correctWinnerSnapshot(input: {
  current: WinnerSnapshot;
  adminId: string;
  now: Date;
  reason: string;
  overallSubmissionIds: string[];
}): WinnerSnapshot {
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('A correction reason is required');
  const pool =
    input.current.overall.tiedCandidates.length > 0
      ? input.current.overall.tiedCandidates
      : input.current.overall.winners;
  const poolIds = new Set(pool.map((candidate) => candidate.submissionId));
  if (input.overallSubmissionIds.length === 0) {
    throw new ValidationError('At least one certified submission is required');
  }
  for (const id of input.overallSubmissionIds) {
    if (!poolIds.has(id)) {
      throw new ValidationError(
        'Corrected winners must come from the certified candidate set',
      );
    }
  }
  const winners = pool
    .filter((candidate) => input.overallSubmissionIds.includes(candidate.submissionId))
    .map((candidate) => ({
      ...candidate,
      coWinner: input.overallSubmissionIds.length > 1,
    }));
  const previous = { ...input.current, revisions: [] };
  return {
    ...input.current,
    certificationStatus: 'corrected',
    version: input.current.version + 1,
    finalizedAt: input.now.toISOString(),
    finalizedById: input.adminId,
    overall: {
      ...input.current.overall,
      result: 'winners',
      message: null,
      winners,
    },
    revisions: [
      ...input.current.revisions,
      {
        version: input.current.version,
        at: input.now.toISOString(),
        adminId: input.adminId,
        reason,
        previous,
      },
    ],
  };
}

export function candidatesFromRatings(
  submissions: Array<Omit<PledgeCandidate, 'distinctVoterCount' | 'validRatingCount'>>,
  ratings: VoterRatingRow[],
): PledgeCandidate[] {
  return submissions.map((submission) => ({
    ...submission,
    distinctVoterCount: countDistinctVoters(ratings, submission.submissionId),
    validRatingCount: countValidRatings(ratings, submission.submissionId),
  }));
}

export function publicArchiveSnapshot(snapshot: WinnerSnapshot) {
  return {
    contestId: snapshot.contestId,
    seriesSlug: snapshot.seriesSlug,
    cycleMonth: snapshot.cycleMonth,
    finalizedAt: snapshot.finalizedAt,
    certificationStatus: snapshot.certificationStatus,
    version: snapshot.version,
    thresholds: snapshot.thresholds,
    categoryNames: snapshot.categoryNames,
    overall: snapshot.overall,
    categories: snapshot.categories,
  };
}

function asSnapshot(value: unknown): WinnerSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as WinnerSnapshot;
  if (!snapshot.cycleMonth || !snapshot.overall) return null;
  return snapshot;
}

type WinnerCorrectionTransaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

let runWinnerCorrection: WinnerCorrectionTransaction = (fn) => prisma.$transaction(fn);

/** Test seam. Pass null to restore prisma.$transaction. */
export function setWinnerCorrectionTransaction(
  runner: WinnerCorrectionTransaction | null,
): void {
  runWinnerCorrection = runner ?? ((fn) => prisma.$transaction(fn));
}

export class PledgeFinalizationService {
  static async finalizeMonthlyWinners(
    contestId: string,
    adminId: string,
    acceptTies = false,
    now = new Date(),
  ): Promise<WinnerSnapshot> {
    const contest = await ContestRepository.findById(contestId);
    if (!contest) throw new NotFoundError('Contest not found');
    const finalizable: FinalizableContest = {
      id: contest.id,
      seriesSlug: contest.seriesSlug,
      cycleMonth: contest.cycleMonth,
      status: contest.status,
      votingClosesAt: contest.votingClosesAt,
      minOverallVoters: contest.minOverallVoters,
      minCategoryVoters: contest.minCategoryVoters,
      isWinnersFinalized: contest.isWinnersFinalized,
      winnersData: asSnapshot(contest.winnersData),
      categoryName: contest.category?.name ?? null,
    };
    assertPledgeFinalizable(finalizable, now);
    const submissions = await SubmissionRepository.listLeaderboardForContest(contestId);
    const ratings = await RatingRepository.listVoterRows(contestId);
    const candidates = candidatesFromRatings(
      submissions.map((submission) => ({
        submissionId: submission.id,
        creatorId: submission.creatorId,
        creatorName: submission.creator.name,
        title: submission.title,
        videoUrl: submission.videoUrl,
        categoryName: submission.contest.category?.name ?? null,
        communityScore: submission.communityScore,
      })),
      ratings,
    );
    const { snapshot, tiePending } = buildWinnerSnapshot({
      contest: finalizable,
      candidates,
      adminId,
      now,
      acceptTies,
    });
    if (tiePending.length > 0) {
      throw new ConflictError(
        'Tied eligible submissions require acceptTies before certification',
      );
    }
    await ContestRepository.certifyWinners(
      contestId,
      snapshot as unknown as Prisma.InputJsonValue,
      contest.status === ContestStatus.JUDGING,
    );
    return snapshot;
  }

  static async correctWinner(
    contestId: string,
    adminId: string,
    reason: string,
    overallSubmissionIds: string[],
    now = new Date(),
  ): Promise<WinnerSnapshot> {
    return runWinnerCorrection(async (tx) => {
      const contest = await ContestRepository.lockById(contestId, tx);
      if (!contest) throw new NotFoundError('Contest not found');
      if (contest.seriesSlug !== PLEDGE_SERIES_SLUG) {
        throw new ConflictError('Only a Pledge monthly contest can be corrected');
      }
      const current = asSnapshot(contest.winnersData);
      if (!contest.isWinnersFinalized || !current) {
        throw new ConflictError('Winners must be certified before they can be corrected');
      }
      const next = correctWinnerSnapshot({
        current,
        adminId,
        now,
        reason,
        overallSubmissionIds,
      });
      await ContestRepository.replaceWinnerSnapshot(
        contestId,
        next as unknown as Prisma.InputJsonValue,
        tx,
      );
      await AuditLogRepository.create(
        {
          submissionId: null,
          actorId: adminId,
          action: 'CORRECT_WINNER',
          reason: reason.trim(),
          metadata: {
            contestId,
            previousVersion: current.version,
            correctedVersion: next.version,
            previous: current as unknown as Prisma.InputJsonValue,
            corrected: next as unknown as Prisma.InputJsonValue,
            at: now.toISOString(),
          },
        },
        tx,
      );
      return next;
    });
  }

  static async listPublicArchive(page: number, limit: number) {
    const rows = await ContestRepository.listCertifiedPledge();
    const items = rows.flatMap((row) => {
      const snapshot = asSnapshot(row.winnersData);
      if (!snapshot) return [];
      return [
        {
          contestId: row.id,
          cycleMonth: row.cycleMonth,
          winnersFinalizedAt:
            row.winnersFinalizedAt?.toISOString() ?? snapshot.finalizedAt,
          winners: publicArchiveSnapshot(snapshot),
        },
      ];
    });
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit),
      pagination: {
        totalCount: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / limit)),
        currentPage: page,
        limit,
        hasNextPage: start + limit < items.length,
        hasPrevPage: page > 1,
      },
    };
  }
}

export function pledgeLeaderboardPartition<
  T extends { id: string; communityScore: number; categoryName: string | null },
>(
  rows: T[],
  ratings: VoterRatingRow[],
  options: {
    categoryScoped: boolean;
    minOverallVoters: number;
    minCategoryVoters: number;
  },
) {
  const decorated = rows.map((row) => {
    const quorum = decideQuorum({
      distinctVoterCount: countDistinctVoters(ratings, row.id),
      validRatingCount: countValidRatings(ratings, row.id),
      requiredOverallVoters: options.minOverallVoters,
      requiredCategoryRatings: options.minCategoryVoters,
      categoryScoped: options.categoryScoped,
    });
    return { ...row, ...quorum };
  });
  const qualified = decorated.filter((row) => row.isQuorumQualified);
  const pending = decorated.filter((row) => !row.isQuorumQualified);
  return { qualified, pending };
}
