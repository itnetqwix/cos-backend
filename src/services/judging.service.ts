import { ContestStatus, Prisma, Role, SubmissionStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ContestRepository } from '../repositories/contest.repository.js';
import {
  InsertRatingData,
  LockedSubmissionScore,
  RatingRepository,
} from '../repositories/rating.repository.js';
import {
  JudgingQueueRecord,
  SubmissionRepository,
} from '../repositories/submission.repository.js';
import { computeCommunityScore, CommunityScoreResult } from './community-score.js';
import { playbackUrlForSubmission } from './storage.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';

/**
 * Judging queue and ratings (M08-P02).
 *
 * Voting window (M08-P02-T05), from domain-model.md §3.1 and BR-VOTE-01:
 * - ACTIVE: viewer voting is open
 * - JUDGING: submissions are closed and the voting queue stays open
 * - COMPLETED: voting is closed
 *
 * Allowed set: ACTIVE, JUDGING.
 * Rejected set: DRAFT, SCHEDULED, COMPLETED, ARCHIVED.
 *
 * Auth: a rating does not require a token. Guests vote without an account.
 * An authenticated ADMIN or CREATOR is not a guest and receives 403.
 * Invalid tokens are 401 in authenticateOptional, before this service runs.
 *
 * voterFingerprint is optional. The algorithm is NOT SPECIFIED, so the value
 * is stored as sent and is not required.
 *
 * Duplicate ratings are allowed. There is no unique (user, submission)
 * constraint and no retry/idempotency rule. Each call inserts a new Rating.
 *
 * Queue order is createdAt then id ascending. That is display order.
 * Ranking by communityScore is M09 and is not done here.
 */

export const VOTING_CONTEST_STATUSES: ReadonlySet<ContestStatus> = new Set([
  ContestStatus.ACTIVE,
  ContestStatus.JUDGING,
]);

export interface JudgingVoter {
  id: string;
  role: Role;
}

export interface RateSubmissionInput {
  contestId: string;
  videoId: string;
  rating: number;
  voter: JudgingVoter | null;
  voterFingerprint: string | null;
}

export interface JudgingQueueItem {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  tags: string[];
  communityScore: number;
  totalVotes: number;
  status: SubmissionStatus;
  category: string | null;
  creator: { id: string; name: string };
  createdAt: Date;
}

export interface JudgingQueueView {
  contestId: string;
  status: ContestStatus;
  autoAdvanceDelayMs: number;
  items: JudgingQueueItem[];
}

type TransactionClient = Prisma.TransactionClient;
type TransactionRunner = <T>(fn: (tx: TransactionClient) => Promise<T>) => Promise<T>;

let runTransaction: TransactionRunner = (fn) => prisma.$transaction(fn);

/** Test seam. Pass null to restore prisma.$transaction. */
export function setJudgingTransactionRunner(runner: TransactionRunner | null): void {
  runTransaction = runner ?? ((fn) => prisma.$transaction(fn));
}

export function assertRatingValue(rating: number): void {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError('Rating must be an integer from 1 to 5');
  }
}

export function assertVotingContest(status: ContestStatus): void {
  if (!VOTING_CONTEST_STATUSES.has(status)) {
    throw new ConflictError(
      'Votes are only accepted while a contest is ACTIVE or JUDGING',
    );
  }
}

function assertVoter(voter: JudgingVoter | null): void {
  if (!voter) return;
  throw new ForbiddenError(
    `Forbidden: User role '${voter.role}' does not have permission to access this resource`,
  );
}

function toQueueItem(row: JudgingQueueRecord): JudgingQueueItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl,
    durationSeconds: row.durationSeconds,
    tags: row.tags,
    communityScore: row.communityScore,
    totalVotes: row.totalVotes,
    status: row.status,
    category: row.contest.category?.name ?? null,
    creator: { id: row.creator.id, name: row.creator.name },
    createdAt: row.createdAt,
  };
}

export class JudgingService {
  static async getQueue(contestId: string): Promise<JudgingQueueView> {
    const contest = await ContestRepository.findById(contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    assertVotingContest(contest.status);
    const rows = await SubmissionRepository.listApprovedForContest(contestId);
    const items = await Promise.all(
      rows.map(async (row) => ({
        ...toQueueItem(row),
        videoUrl: await playbackUrlForSubmission(row.objectKey, row.videoUrl),
      })),
    );
    return {
      contestId: contest.id,
      status: contest.status,
      autoAdvanceDelayMs: contest.autoAdvanceDelayMs,
      items,
    };
  }

  static async rateSubmission(input: RateSubmissionInput): Promise<CommunityScoreResult> {
    assertVoter(input.voter);
    assertRatingValue(input.rating);

    return runTransaction(async (tx) => {
      const locked: LockedSubmissionScore | null = await RatingRepository.lockSubmission(
        input.contestId,
        input.videoId,
        tx,
      );
      if (!locked) {
        throw new NotFoundError('Submission not found');
      }
      assertVotingContest(locked.contestStatus);
      if (locked.status !== SubmissionStatus.APPROVED) {
        throw new ConflictError('Only approved submissions can be rated');
      }

      const score = computeCommunityScore(
        locked.communityScore,
        locked.totalVotes,
        input.rating,
      );
      const ratingRow: InsertRatingData = {
        submissionId: locked.id,
        userId: input.voter?.id ?? null,
        voterFingerprint: input.voterFingerprint,
        rating: input.rating,
      };
      await RatingRepository.insert(ratingRow, tx);
      await RatingRepository.writeScore(locked.id, score.newScore, score.totalVotes, tx);
      return score;
    });
  }
}
