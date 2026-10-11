import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountStatus, ContestStatus, Role, SubmissionStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { AdminCreatorRepository } from '../../src/repositories/admin-creator.repository.js';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import { CreatorActivityRepository } from '../../src/repositories/creator-activity.repository.js';
import { RatingRepository } from '../../src/repositories/rating.repository.js';
import {
  SubmissionRecord,
  SubmissionRepository,
} from '../../src/repositories/submission.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AdminCreatorService } from '../../src/services/admin-creator.service.js';
import { CommentService } from '../../src/services/comment.service.js';
import { JudgingService } from '../../src/services/judging.service.js';
import { LeaderboardService } from '../../src/services/leaderboard.service.js';
import { ModerationService } from '../../src/services/moderation.service.js';
import { setStorageService } from '../../src/services/storage.service.js';
import { VoterService } from '../../src/services/voter.service.js';
import { ConflictError, NotFoundError } from '../../src/utils/response.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CREATOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CREATOR_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const CONTEST = '11111111-1111-4111-8111-111111111111';
const MINE = '22222222-2222-4222-8222-222222222221';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THEIRS = '22222222-2222-4222-8222-222222222223';

const ratings = [{ id: 'rating-1', submissionId: MINE, rating: 9 }];

function row(
  id: string,
  creatorId: string,
  score: number,
  votes: number,
): SubmissionRecord {
  const now = new Date('2026-10-04T00:00:00.000Z');
  return {
    id,
    contestId: CONTEST,
    creatorId,
    title: id === MINE ? 'Night Shift Bit' : 'Other Bit',
    description: null,
    videoUrl: `https://example.com/${id}.mp4`,
    objectKey: `kept/${id}.mp4`,
    thumbnailUrl: null,
    durationSeconds: 20,
    status: SubmissionStatus.APPROVED,
    rejectionReason: null,
    moderatedById: null,
    moderatedAt: null,
    tags: [],
    communityScore: score,
    totalVotes: votes,
    deletedAt: null,
    deletedById: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    contest: {
      id: CONTEST,
      title: 'Open Mic',
      status: ContestStatus.ACTIVE,
      category: null,
    },
  };
}

describe('creator submission soft delete', { concurrency: false }, () => {
  let app: FastifyInstance;
  const memory = new Map<string, SubmissionRecord>();
  const activity: Array<{ action: string; performedByUserId?: string | null }> = [];
  let failDelete = false;

  const original = {
    findById: SubmissionRepository.findById,
    listByCreatorId: SubmissionRepository.listByCreatorId,
    softDeleteOwned: SubmissionRepository.softDeleteOwned,
    listApproved: SubmissionRepository.listApprovedForContest,
    listLeaderboard: SubmissionRepository.listLeaderboardForContest,
    listPending: SubmissionRepository.listPendingReview,
    listParticipation: SubmissionRepository.listCreatorParticipation,
    findContest: ContestRepository.findById,
    findAccountGate: UserRepository.findAccountGate,
    findCreatorById: UserRepository.findCreatorById,
    createActivity: CreatorActivityRepository.create,
    lockSubmission: RatingRepository.lockSubmission,
    pageParticipants: AdminCreatorRepository.pageContestParticipants,
    countParticipants: AdminCreatorRepository.countContestParticipants,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    setStorageService({
      async createPresignedUpload() {
        throw new Error('unused');
      },
    });
    app = await buildApp();
    await app.ready();

    UserRepository.findAccountGate = (async () => ({
      id: CREATOR_A,
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
    })) as typeof UserRepository.findAccountGate;

    CreatorActivityRepository.create = (async (data) => {
      activity.push({
        action: data.action,
        performedByUserId: data.performedByUserId,
      });
      return { id: 'activity-1', createdAt: new Date(), ...data };
    }) as typeof CreatorActivityRepository.create;

    SubmissionRepository.findById = (async (id: string) =>
      memory.get(id) ?? null) as typeof SubmissionRepository.findById;

    SubmissionRepository.listByCreatorId = (async (
      creatorId: string,
      options?: { includeDeleted?: boolean },
    ) =>
      [...memory.values()].filter(
        (item) =>
          item.creatorId === creatorId && (options?.includeDeleted || item.deletedAt === null),
      )) as typeof SubmissionRepository.listByCreatorId;

    SubmissionRepository.softDeleteOwned = (async (id: string, creatorId: string) => {
      if (failDelete) throw new Error('database unavailable');
      const current = memory.get(id);
      if (!current || current.creatorId !== creatorId || current.deletedAt) return null;
      current.deletedAt = new Date('2026-10-11T12:00:00.000Z');
      current.deletedById = creatorId;
      current.deletedBy = { id: creatorId, name: 'Ada' };
      return current;
    }) as typeof SubmissionRepository.softDeleteOwned;

    SubmissionRepository.listApprovedForContest = (async (contestId: string) =>
      [...memory.values()]
        .filter(
          (item) =>
            item.contestId === contestId &&
            item.status === SubmissionStatus.APPROVED &&
            item.deletedAt === null,
        )
        .map((item) => ({
          ...item,
          creator: { id: item.creatorId, name: 'Ada', avatarObjectKey: null },
          contest: { id: CONTEST, status: ContestStatus.ACTIVE, category: null },
        }))) as typeof SubmissionRepository.listApprovedForContest;

    SubmissionRepository.listLeaderboardForContest = (async (contestId: string) =>
      [...memory.values()]
        .filter(
          (item) =>
            item.contestId === contestId &&
            item.status === SubmissionStatus.APPROVED &&
            item.deletedAt === null,
        )
        .sort((a, b) => b.communityScore - a.communityScore)
        .map((item) => ({
          ...item,
          creator: { id: item.creatorId, name: 'Ada', avatarObjectKey: null },
        }))) as typeof SubmissionRepository.listLeaderboardForContest;

    SubmissionRepository.listPendingReview = (async () =>
      [...memory.values()].filter(
        (item) => item.status === SubmissionStatus.PENDING_REVIEW && item.deletedAt === null,
      )) as typeof SubmissionRepository.listPendingReview;

    RatingRepository.lockSubmission = (async (contestId: string, submissionId: string) => {
      const current = memory.get(submissionId);
      if (!current || current.contestId !== contestId || current.deletedAt) return null;
      return {
        id: current.id,
        contestId: current.contestId,
        status: current.status,
        communityScore: current.communityScore,
        totalVotes: current.totalVotes,
        contestStatus: ContestStatus.ACTIVE,
      };
    }) as typeof RatingRepository.lockSubmission;

    ContestRepository.findById = (async (id: string) => {
      if (id !== CONTEST) return null;
      const now = new Date('2026-10-01T00:00:00.000Z');
      return {
        id: CONTEST,
        categoryId: null,
        title: 'Open Mic',
        description: 'Bits',
        tagline: null,
        bannerUrl: null,
        bannerObjectKey: null,
        thumbnailUrl: null,
        timezone: 'Asia/Kolkata',
        votingClosesAt: null,
        status: ContestStatus.ACTIVE,
        startDate: now,
        endDate: new Date('2026-10-31T00:00:00.000Z'),
        prizeSummary: null,
        rules: [],
        autoAdvanceDelayMs: 1800,
        createdAt: now,
        updatedAt: now,
        category: null,
      };
    }) as typeof ContestRepository.findById;
  });

  after(async () => {
    SubmissionRepository.findById = original.findById;
    SubmissionRepository.listByCreatorId = original.listByCreatorId;
    SubmissionRepository.softDeleteOwned = original.softDeleteOwned;
    SubmissionRepository.listApprovedForContest = original.listApproved;
    SubmissionRepository.listLeaderboardForContest = original.listLeaderboard;
    SubmissionRepository.listPendingReview = original.listPending;
    SubmissionRepository.listCreatorParticipation = original.listParticipation;
    ContestRepository.findById = original.findContest;
    UserRepository.findAccountGate = original.findAccountGate;
    UserRepository.findCreatorById = original.findCreatorById;
    CreatorActivityRepository.create = original.createActivity;
    RatingRepository.lockSubmission = original.lockSubmission;
    AdminCreatorRepository.pageContestParticipants = original.pageParticipants;
    AdminCreatorRepository.countContestParticipants = original.countParticipants;
    setStorageService(null);
    await app.close();
  });

  function token(role: Role, id: string): string {
    return app.jwt.sign({ id, email: `${role.toLowerCase()}@contestos.com`, role });
  }

  function seed(): void {
    memory.clear();
    activity.length = 0;
    failDelete = false;
    ratings.splice(0, ratings.length, { id: 'rating-1', submissionId: MINE, rating: 9 });
    memory.set(MINE, row(MINE, CREATOR_A, 9, 4));
    memory.set(OTHER, row(OTHER, CREATOR_A, 7.4, 3));
    memory.set(THEIRS, row(THEIRS, CREATOR_B, 6, 1));
  }

  it('soft-deletes the owner row and keeps it gone after refetch', async () => {
    seed();
    const auth = { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` };
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/submissions/${MINE}`,
      headers: auth,
    });
    assert.equal(deleted.statusCode, 200);
    const body = JSON.parse(deleted.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.deleted, true);
    assert.equal(body.data.deletedAt, '2026-10-11T12:00:00.000Z');

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/submissions/${MINE}`,
      headers: auth,
    });
    assert.equal(again.statusCode, 200);
    assert.equal(JSON.parse(again.payload).data.deletedAt, body.data.deletedAt);
    assert.equal(activity.length, 1);
    assert.equal(activity[0].action, 'SUBMISSION_DELETED');
    assert.equal(activity[0].performedByUserId, CREATOR_A);

    const list = await app.inject({ method: 'GET', url: '/api/v1/submissions/me', headers: auth });
    const ids = JSON.parse(list.payload).data.map((item: { id: string }) => item.id);
    assert.equal(ids.includes(MINE), false);
    assert.equal(ids.includes(OTHER), true);

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/v1/submissions/${MINE}`,
      headers: auth,
    });
    assert.equal(hidden.statusCode, 404);

    const kept = memory.get(MINE);
    assert.ok(kept);
    assert.equal(kept.communityScore, 9);
    assert.equal(kept.totalVotes, 4);
    assert.equal(kept.objectKey, `kept/${MINE}.mp4`);
    assert.deepEqual(ratings, [{ id: 'rating-1', submissionId: MINE, rating: 9 }]);
    assert.equal(memory.get(OTHER)?.communityScore, 7.4);
  });

  it('rejects missing auth, admins on the creator route, and another creator', async () => {
    seed();
    const missing = await app.inject({ method: 'DELETE', url: `/api/v1/submissions/${MINE}` });
    assert.equal(missing.statusCode, 401);

    const admin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/submissions/${MINE}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN, ADMIN)}` },
    });
    assert.equal(admin.statusCode, 403);

    const other = await app.inject({
      method: 'DELETE',
      url: `/api/v1/submissions/${MINE}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_B)}` },
    });
    assert.equal(other.statusCode, 404);
    assert.equal(memory.get(MINE)?.deletedAt, null);
    assert.equal(activity.length, 0);
  });

  it('leaves the row active when the delete write fails', async () => {
    seed();
    failDelete = true;
    const failed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/submissions/${MINE}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` },
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(JSON.parse(failed.payload).success, false);
    assert.equal(memory.get(MINE)?.deletedAt, null);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/submissions/me',
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` },
    });
    const ids = JSON.parse(list.payload).data.map((item: { id: string }) => item.id);
    assert.equal(ids.includes(MINE), true);
  });

  it('hides a deleted video from the queue, leaderboard, rating, and comments', async () => {
    seed();
    memory.get(MINE)!.deletedAt = new Date('2026-10-11T12:00:00.000Z');
    const before = memory.get(OTHER)!.communityScore;

    const queue = await JudgingService.getQueue(CONTEST);
    assert.equal(
      queue.items.some((item) => item.id === MINE),
      false,
    );
    const queued = queue.items.find((item) => item.id === OTHER);
    assert.equal(queued?.communityScore, before);

    const board = await LeaderboardService.getContestLeaderboard(CONTEST);
    assert.equal(
      board.items.some((item) => item.id === MINE),
      false,
    );
    const ranked = board.items.find((item) => item.id === OTHER);
    assert.equal(ranked?.communityScore, before);
    assert.equal(ranked?.totalVotes, 3);
    assert.equal(memory.get(MINE)?.communityScore, 9);
    assert.deepEqual(ratings, [{ id: 'rating-1', submissionId: MINE, rating: 9 }]);

    await assert.rejects(
      () =>
        JudgingService.rateSubmission({
          contestId: CONTEST,
          videoId: MINE,
          rating: 8,
          voter: null,
          voterFingerprint: null,
          voterIpHash: 'hash',
        }),
      NotFoundError,
    );
    assert.equal(memory.get(OTHER)?.communityScore, before);

    await assert.rejects(() => CommentService.listForSubmission(MINE), NotFoundError);
    await assert.rejects(() => VoterService.listForSubmission(MINE, 1, 20), NotFoundError);

    memory.get(MINE)!.status = SubmissionStatus.PENDING_REVIEW;
    const pending = await ModerationService.listQueue({ id: ADMIN, role: Role.ADMIN });
    assert.equal(
      pending.some((item) => item.id === MINE),
      false,
    );
    await assert.rejects(
      () => ModerationService.approve({ id: ADMIN, role: Role.ADMIN }, MINE),
      ConflictError,
    );
  });

  it('shows creator-deleted submissions to admins with the actor and timestamp', async () => {
    seed();
    const deletedAt = new Date('2026-10-11T12:00:00.000Z');
    const mine = memory.get(MINE)!;
    mine.deletedAt = deletedAt;
    mine.deletedById = CREATOR_A;
    mine.deletedBy = { id: CREATOR_A, name: 'Ada' };

    UserRepository.findCreatorById = (async () => ({
      id: CREATOR_A,
      name: 'Ada',
      email: 'ada@example.com',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    })) as typeof UserRepository.findCreatorById;

    SubmissionRepository.listCreatorParticipation = (async () =>
      [...memory.values()]
        .filter((item) => item.creatorId === CREATOR_A)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          contestId: item.contestId,
          communityScore: item.communityScore,
          totalVotes: item.totalVotes,
          deletedAt: item.deletedAt,
          deletedBy: item.deletedBy,
          contest: item.contest,
        }))) as typeof SubmissionRepository.listCreatorParticipation;

    const contests = await AdminCreatorService.listContests(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR_A,
    );
    const listed = contests.contests.flatMap((contest) => contest.submissions);
    const deleted = listed.find((item) => item.id === MINE);
    assert.ok(deleted);
    assert.equal(deleted.title, 'Night Shift Bit');
    assert.equal(deleted.deletedAt?.toISOString(), deletedAt.toISOString());
    assert.equal(deleted.deletedBy?.id, CREATOR_A);
    assert.equal(deleted.deletedBy?.name, 'Ada');

    AdminCreatorRepository.countContestParticipants = async () => 1;
    AdminCreatorRepository.pageContestParticipants = (async () => ({
      groups: [
        {
          creatorId: CREATOR_A,
          _count: { _all: 2 },
          _min: { createdAt: mine.createdAt },
          _max: { createdAt: mine.createdAt },
        },
      ],
      creators: [
        {
          id: CREATOR_A,
          name: 'Ada',
          email: 'ada@example.com',
          role: Role.CREATOR,
          accountStatus: AccountStatus.ACTIVE,
          createdAt: mine.createdAt,
        },
      ],
      submissions: [
        {
          id: mine.id,
          creatorId: CREATOR_A,
          title: mine.title,
          status: mine.status,
          createdAt: mine.createdAt,
          updatedAt: mine.updatedAt,
          communityScore: mine.communityScore,
          totalVotes: mine.totalVotes,
          deletedAt: mine.deletedAt,
          deletedBy: mine.deletedBy,
        },
      ],
    })) as typeof AdminCreatorRepository.pageContestParticipants;

    const participants = await AdminCreatorService.contestParticipants(
      { id: ADMIN, role: Role.ADMIN },
      CONTEST,
    );
    assert.equal(participants.creators[0].submissions[0].deletedBy?.name, 'Ada');
    assert.equal(
      participants.creators[0].submissions[0].deletedAt?.toISOString(),
      deletedAt.toISOString(),
    );
  });

  it('keeps public queries on active rows and admin queries on every row', () => {
    const repository = readFileSync(
      join(ROOT, 'src/repositories/submission.repository.ts'),
      'utf8',
    );
    const rating = readFileSync(join(ROOT, 'src/repositories/rating.repository.ts'), 'utf8');
    const body = (name: string) => {
      const start = repository.indexOf(`static async ${name}`);
      const next = repository.indexOf('\n  static async ', start + 1);
      return repository.slice(start, next === -1 ? undefined : next);
    };
    for (const name of [
      'listByCreatorId',
      'listPendingReview',
      'listApprovedForContest',
      'listLeaderboardForContest',
    ]) {
      assert.match(body(name), /notDeleted/);
    }
    assert.doesNotMatch(body('pageByCreator'), /notDeleted/);
    assert.doesNotMatch(body('listCreatorParticipation'), /notDeleted/);
    assert.match(body('softDeleteOwned'), /updateMany/);
    assert.doesNotMatch(body('softDeleteOwned'), /submission\.delete/);
    assert.match(body('deleteById'), /submission\.delete/);
    assert.match(rating, /s\."deletedAt" IS NULL/);
  });
});
