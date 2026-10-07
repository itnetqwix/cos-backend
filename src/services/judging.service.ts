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
import {
  computeCommunityScore,
  computeUpdatedCommunityScore,
  CommunityScoreResult,
} from './community-score.js';
import { playbackUrlForSubmission, signedAvatarUrl } from './storage.service.js';
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
 * One current rating is stored per submission and hashed client IP.
 * A later rating from that identifier updates the same row.
 * The same identifier may rate a different video.
 * Two first-time inserts that hit the unique index still return 409.
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
  viewerRating: number | null;
  status: SubmissionStatus;
  category: string | null;
  creator: { id: string; name: string; avatarUrl?: string | null };
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

let runTransaction: TransactionRunner = (fn) =>
  prisma.$transaction(fn, { maxWait: 10000, timeout: 30000 });

/** Test seam. Pass null to restore prisma.$transaction. */
export function setJudgingTransactionRunner(runner: TransactionRunner | null): void {
  runTransaction =
    runner ?? ((fn) => prisma.$transaction(fn, { maxWait: 10000, timeout: 30000 }));
}

export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** New ratings are integers 1–10. Stored historical 1–5 rows are not rewritten. */
export function assertRatingValue(rating: number): void {
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
    throw new ValidationError('Rating must be an integer from 1 to 10');
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

export interface RateSubmissionResult extends CommunityScoreResult {
  ratingId: string;
  viewerRating: number;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertVoter(voter: JudgingVoter | null): void {
  if (!voter) return;
  throw new ForbiddenError(
    `Forbidden: User role '${voter.role}' does not have permission to access this resource`,
  );
}

function toQueueItem(
  row: JudgingQueueRecord,
  avatarUrl: string | null,
): JudgingQueueItem {
  const creator: JudgingQueueItem['creator'] = {
    id: row.creator.id,
    name: row.creator.name,
  };
  if (avatarUrl) creator.avatarUrl = avatarUrl;
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
    viewerRating: null,
    status: row.status,
    category: row.contest.category?.name ?? null,
    creator,
    createdAt: row.createdAt,
  };
}

export class JudgingService {
  static async getQueue(
    contestId: string,
    voterIpHash?: string | null,
  ): Promise<JudgingQueueView> {
    const contest = await ContestRepository.findById(contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    assertViewableContest(contest.status);
    const rows = await SubmissionRepository.listApprovedForContest(contestId);
    const avatarUrls = new Map<string, Promise<string | null>>();
    const avatarFor = (objectKey: string | null | undefined) => {
      if (!objectKey) return Promise.resolve(null);
      const pending = avatarUrls.get(objectKey);
      if (pending) return pending;
      const next = signedAvatarUrl(objectKey);
      avatarUrls.set(objectKey, next);
      return next;
    };
    const items = await Promise.all(
      rows.map(async (row) => ({
        ...toQueueItem(row, await avatarFor(row.creator.avatarObjectKey)),
        videoUrl: await playbackUrlForSubmission(row.objectKey, row.videoUrl, {
          audience: 'public',
        }),
      })),
    );
    const viewerRatings = voterIpHash
      ? await RatingRepository.listGuestRatings(
          items.map((item) => item.id),
          voterIpHash,
        )
      : [];
    const viewerRatingBySubmission = new Map(
      viewerRatings.map((row) => [row.submissionId, row.rating]),
    );
    return {
      contestId: contest.id,
      status: contest.status,
      ratingOpen: VOTING_CONTEST_STATUSES.has(contest.status),
      autoAdvanceDelayMs: contest.autoAdvanceDelayMs,
      items: items.map((item) => ({
        ...item,
        viewerRating: viewerRatingBySubmission.get(item.id) ?? null,
      })),
    };
  }

  static async rateSubmission(input: RateSubmissionInput): Promise<RateSubmissionResult> {
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
        if (existing.rating === input.rating) {
          return {
            previousScore: locked.communityScore,
            newScore: locked.communityScore,
            delta: 0,
            totalVotes: locked.totalVotes,
            ratingId: existing.id,
            viewerRating: existing.rating,
          };
        }
        const score = computeUpdatedCommunityScore(
          locked.communityScore,
          locked.totalVotes,
          existing.rating,
          input.rating,
        );
        await RatingRepository.updateGuestRating(existing.id, input.rating, tx);
        await RatingRepository.writeScore(
          locked.id,
          score.newScore,
          score.totalVotes,
          tx,
        );
        return {
          ...score,
          ratingId: existing.id,
          viewerRating: input.rating,
        };
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
      let created: { id: string; rating: number };
      try {
        created = await RatingRepository.insert(ratingRow, tx);
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ConflictError(ALREADY_RATED_MESSAGE);
        }
        throw error;
      }
      await RatingRepository.writeScore(locked.id, score.newScore, score.totalVotes, tx);
      return {
        ...score,
        ratingId: created.id,
        viewerRating: created.rating,
      };
    });
  }
}
