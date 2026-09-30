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
 * Rating set: ACTIVE, JUDGING.
 * Viewing set: ACTIVE, JUDGING, COMPLETED, ARCHIVED.
 * Rejected for both: DRAFT, SCHEDULED.
 *
 * Auth: a rating does not require a token. Guests vote without an account.
 * An authenticated ADMIN or CREATOR is not a guest and receives 403.
 * Invalid tokens are 401 in authenticateOptional, before this service runs.
 *
 * voterFingerprint is optional client metadata. It is not the vote key.
 *
 * One guest rating is allowed per submission and hashed client IP.
 * The same identifier may rate a different video. A repeat is 409.
 *
 * Queue order is createdAt then id ascending. That is display order.
 * Ranking by communityScore is M09 and is not done here.
 */

export const VOTING_CONTEST_STATUSES: ReadonlySet<ContestStatus> = new Set([
  ContestStatus.ACTIVE,
  ContestStatus.JUDGING,
]);

export const VIEWABLE_CONTEST_STATUSES: ReadonlySet<ContestStatus> = new Set([
  ContestStatus.ACTIVE,
  ContestStatus.JUDGING,
  ContestStatus.COMPLETED,
  ContestStatus.ARCHIVED,
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
  voterIpHash: string;
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
  ratingOpen: boolean;
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

export function assertViewableContest(status: ContestStatus): void {
  if (!VIEWABLE_CONTEST_STATUSES.has(status)) {
    throw new ConflictError('This contest is not available for viewing');
  }
}

export const ALREADY_RATED_MESSAGE = 'You have already rated this video.';

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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
    assertViewableContest(contest.status);
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
      ratingOpen: VOTING_CONTEST_STATUSES.has(contest.status),
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

      const existing = await RatingRepository.findGuestVote(
        locked.id,
        input.voterIpHash,
        tx,
      );
      if (existing) {
        throw new ConflictError(ALREADY_RATED_MESSAGE);
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
        voterIpHash: input.voterIpHash,
        rating: input.rating,
      };
      try {
        await RatingRepository.insert(ratingRow, tx);
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ConflictError(ALREADY_RATED_MESSAGE);
        }
        throw error;
      }
      await RatingRepository.writeScore(locked.id, score.newScore, score.totalVotes, tx);
      return score;
    });
  }
}
