import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { ContestStatus, Prisma, Role, SubmissionStatus } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { ContestRecord, ContestRepository } from '../../src/repositories/contest.repository.js';
import {
  InsertRatingData,
  LockedSubmissionScore,
  RatingRepository,
} from '../../src/repositories/rating.repository.js';
import {
  JudgingQueueRecord,
  SubmissionRepository,
} from '../../src/repositories/submission.repository.js';
import { setJudgingTransactionRunner } from '../../src/services/judging.service.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const CONTEST_A = '11111111-1111-4111-8111-111111111111';
const CONTEST_B = '11111111-1111-4111-8111-111111111112';
const VIDEO_A = '22222222-2222-4222-8222-222222222221';
const VIDEO_B = '22222222-2222-4222-8222-222222222222';
const VIDEO_PENDING = '22222222-2222-4222-8222-222222222223';
const VIDEO_REJECTED = '22222222-2222-4222-8222-222222222224';
const VIDEO_FLAGGED = '22222222-2222-4222-8222-222222222225';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-0000000000aa';
const CREATOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb';

interface MemorySubmission {
  id: string;
  contestId: string;
  status: SubmissionStatus;
  communityScore: number;
  totalVotes: number;
  createdAt: Date;
  title: string;
}

interface MemoryRating {
  id: string;
  submissionId: string;
  userId: string | null;
  voterFingerprint: string | null;
  voterIpHash: string;
  rating: number;
}

interface Memory {
  contests: Map<string, ContestRecord>;
  submissions: Map<string, MemorySubmission>;
  ratings: MemoryRating[];
  seq: number;
}

function createMemory(): Memory {
  return {
    contests: new Map(),
    submissions: new Map(),
    ratings: [],
    seq: 1,
  };
}

function contestRow(
  id: string,
  status: ContestStatus,
  autoAdvanceDelayMs = 1800,
): ContestRecord {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id,
    categoryId: 'cat-1',
    title: id === CONTEST_A ? 'Ripskis Open' : 'Other Open',
    description: 'Rules',
    status,
    startDate: now,
    endDate: new Date('2026-12-01T00:00:00.000Z'),
    tagline: null,
    bannerUrl: null,
    thumbnailUrl: null,
    prizeSummary: null,
    rules: null,
    autoAdvanceDelayMs,
    createdAt: now,
    updatedAt: now,
    category: { id: 'cat-1', name: 'Sketch', slug: 'sketch', description: null },
  };
}

function submissionRow(
  id: string,
  contestId: string,
  status: SubmissionStatus,
  createdAt: string,
  score = 0,
  votes = 0,
): MemorySubmission {
  return {
    id,
    contestId,
    status,
    communityScore: score,
    totalVotes: votes,
    createdAt: new Date(createdAt),
    title: `Entry ${id.slice(-4)}`,
  };
}

function toQueueRecord(row: MemorySubmission, contest: ContestRecord): JudgingQueueRecord {
  return {
    id: row.id,
    contestId: row.contestId,
    creatorId: CREATOR_ID,
    title: row.title,
    description: 'A short sketch.',
    videoUrl: `https://cos-test-bucket.s3.us-east-1.amazonaws.com/${row.id}.mp4`,
    objectKey: `contests/${row.contestId}/creators/${CREATOR_ID}/${row.id}.mp4`,
    thumbnailUrl: null,
    durationSeconds: 20,
    status: row.status,
    rejectionReason: null,
    moderatedById: null,
    moderatedAt: null,
    tags: ['sketch'],
    communityScore: row.communityScore,
    totalVotes: row.totalVotes,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    creator: { id: CREATOR_ID, name: 'Ada Creator' },
    contest: {
      id: contest.id,
      status: contest.status,
      category: contest.category
        ? { id: contest.category.id, name: contest.category.name, slug: contest.category.slug }
        : null,
    },
  };
}

describe('M08 judging APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let memory: Memory;

  const original = {
    findContest: ContestRepository.findById,
    listApproved: SubmissionRepository.listApprovedForContest,
    lock: RatingRepository.lockSubmission,
    findGuestVote: RatingRepository.findGuestVote,
    insert: RatingRepository.insert,
    writeScore: RatingRepository.writeScore,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    memory = createMemory();

    let chain: Promise<unknown> = Promise.resolve();
    setJudgingTransactionRunner(async (fn) => {
      const run = chain.then(() => fn({} as Prisma.TransactionClient));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });

    ContestRepository.findById = (async (id: string) => memory.contests.get(id) ?? null) as typeof ContestRepository.findById;

    SubmissionRepository.listApprovedForContest = (async (contestId: string) => {
      const contest = memory.contests.get(contestId);
      if (!contest) return [];
      return [...memory.submissions.values()]
        .filter((row) => row.contestId === contestId && row.status === SubmissionStatus.APPROVED)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((row) => toQueueRecord(row, contest));
    }) as typeof SubmissionRepository.listApprovedForContest;

    RatingRepository.lockSubmission = (async (contestId: string, submissionId: string) => {
      const row = memory.submissions.get(submissionId);
      const contest = memory.contests.get(contestId);
      if (!row || !contest || row.contestId !== contestId) return null;
      const locked: LockedSubmissionScore = {
        id: row.id,
        contestId: row.contestId,
        status: row.status,
        communityScore: row.communityScore,
        totalVotes: row.totalVotes,
        contestStatus: contest.status,
      };
      return locked;
    }) as typeof RatingRepository.lockSubmission;

    RatingRepository.findGuestVote = (async (submissionId: string, voterIpHash: string) => {
      const found = memory.ratings.find(
        (row) => row.submissionId === submissionId && row.voterIpHash === voterIpHash,
      );
      return found ? { id: found.id } : null;
    }) as typeof RatingRepository.findGuestVote;

    RatingRepository.insert = (async (data: InsertRatingData) => {
      const duplicate = memory.ratings.find(
        (row) => row.submissionId === data.submissionId && row.voterIpHash === data.voterIpHash,
      );
      if (duplicate) {
        const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
        throw error;
      }
      const id = `rating-${memory.seq++}`;
      memory.ratings.push({
        id,
        submissionId: data.submissionId,
        userId: data.userId,
        voterFingerprint: data.voterFingerprint,
        voterIpHash: data.voterIpHash,
        rating: data.rating,
      });
      return {
        id,
        rating: data.rating,
        userId: data.userId,
        voterFingerprint: data.voterFingerprint,
      };
    }) as typeof RatingRepository.insert;

    RatingRepository.writeScore = (async (submissionId: string, communityScore: number, totalVotes: number) => {
      const row = memory.submissions.get(submissionId);
      if (!row) return;
      row.communityScore = communityScore;
      row.totalVotes = totalVotes;
    }) as typeof RatingRepository.writeScore;
  });

  after(async () => {
    ContestRepository.findById = original.findContest;
    SubmissionRepository.listApprovedForContest = original.listApproved;
    RatingRepository.lockSubmission = original.lock;
    RatingRepository.findGuestVote = original.findGuestVote;
    RatingRepository.insert = original.insert;
    RatingRepository.writeScore = original.writeScore;
    setJudgingTransactionRunner(null);
    await app.close();
  });

  function seedActive() {
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.ACTIVE, 1800));
    memory.contests.set(CONTEST_B, contestRow(CONTEST_B, ContestStatus.ACTIVE, 2400));
    memory.submissions.set(
      VIDEO_A,
      submissionRow(VIDEO_A, CONTEST_A, SubmissionStatus.APPROVED, '2026-10-01T00:00:00.000Z'),
    );
    memory.submissions.set(
      VIDEO_B,
      submissionRow(VIDEO_B, CONTEST_B, SubmissionStatus.APPROVED, '2026-10-02T00:00:00.000Z'),
    );
    memory.submissions.set(
      VIDEO_PENDING,
      submissionRow(VIDEO_PENDING, CONTEST_A, SubmissionStatus.PENDING_REVIEW, '2026-09-01T00:00:00.000Z'),
    );
    memory.submissions.set(
      VIDEO_REJECTED,
      submissionRow(VIDEO_REJECTED, CONTEST_A, SubmissionStatus.REJECTED, '2026-09-02T00:00:00.000Z'),
    );
    memory.submissions.set(
      VIDEO_FLAGGED,
      submissionRow(VIDEO_FLAGGED, CONTEST_A, SubmissionStatus.FLAGGED, '2026-09-03T00:00:00.000Z'),
    );
  }

  function token(role: Role, id = ADMIN_ID): string {
    return app.jwt.sign({
      id,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
      });
  }

  function rateUrl(contestId = CONTEST_A, videoId = VIDEO_A): string {
    return `/api/v1/contests/${contestId}/videos/${videoId}/rate`;
  }

  it('returns only approved submissions for the requested contest', async () => {
    memory = createMemory();
    seedActive();
    memory.submissions.set(
      '22222222-2222-4222-8222-222222222226',
      submissionRow(
        '22222222-2222-4222-8222-222222222226',
        CONTEST_A,
        SubmissionStatus.APPROVED,
        '2026-10-03T00:00:00.000Z',
        4.2,
        8,
      ),
    );

    const res = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, true);
    assert.equal(body.errors, null);
    assert.equal(body.data.contestId, CONTEST_A);
    assert.equal(body.data.status, 'ACTIVE');
    assert.equal(body.data.autoAdvanceDelayMs, 1800);
    assert.deepEqual(
      body.data.items.map((item: { id: string }) => item.id),
      [VIDEO_A, '22222222-2222-4222-8222-222222222226'],
    );
    assert.equal(body.data.items[0].status, 'APPROVED');
    assert.equal(body.data.items[0].creator.name, 'Ada Creator');
    assert.equal(JSON.stringify(body).includes('passwordHash'), false);
    assert.equal(JSON.stringify(body).includes('objectKey'), false);
  });

  it('does not include another contest or non-approved submissions', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    const body = JSON.parse(res.payload);
    const ids = body.data.items.map((item: { id: string; status: string }) => `${item.id}:${item.status}`);
    assert.equal(ids.includes(`${VIDEO_B}:APPROVED`), false);
    assert.equal(ids.some((id: string) => id.startsWith(VIDEO_PENDING)), false);
    assert.equal(ids.some((id: string) => id.startsWith(VIDEO_REJECTED)), false);
    assert.equal(ids.some((id: string) => id.startsWith(VIDEO_FLAGGED)), false);
  });

  it('returns an empty item list when the contest is open and nothing is approved', async () => {
    memory.submissions.forEach((row) => {
      if (row.contestId === CONTEST_A && row.status === SubmissionStatus.APPROVED) {
        row.status = SubmissionStatus.PENDING_REVIEW;
      }
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    const body = JSON.parse(res.payload);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.data.items, []);
    memory.submissions.get(VIDEO_A)!.status = SubmissionStatus.APPROVED;
  });

  it('keeps completed contest videos viewable and rejects new ratings', async () => {
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.DRAFT));
    const draft = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    assert.equal(draft.statusCode, 409);

    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.COMPLETED));
    const closed = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    assert.equal(closed.statusCode, 200);
    const body = JSON.parse(closed.payload);
    assert.equal(body.data.ratingOpen, false);
    assert.equal(body.data.items.some((item: { id: string }) => item.id === VIDEO_A), true);

    const rated = await app.inject({
      method: 'POST',
      url: rateUrl(),
      remoteAddress: '203.0.113.50',
      payload: { rating: 2 },
    });
    assert.equal(rated.statusCode, 409);
    assert.equal(JSON.parse(rated.payload).message, 'Votes are only accepted while a contest is ACTIVE or JUDGING');

    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.JUDGING, 1800));
    const judging = await app.inject({ method: 'GET', url: `/api/v1/contests/${CONTEST_A}/queue` });
    assert.equal(judging.statusCode, 200);
    assert.equal(JSON.parse(judging.payload).data.ratingOpen, true);
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.ACTIVE, 1800));
  });

  it('returns 404 for an unknown contest', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contests/33333333-3333-4333-8333-333333333333/queue',
    });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(Object.keys(JSON.parse(res.payload)).sort(), ENVELOPE_KEYS);
  });

  it('records an anonymous rating and rounds the community score', async () => {
    memory.ratings = [];
    const row = memory.submissions.get(VIDEO_A)!;
    row.communityScore = 0;
    row.totalVotes = 0;
    row.status = SubmissionStatus.APPROVED;

    const res = await app.inject({
      method: 'POST',
      url: rateUrl(),
      payload: { rating: 5 },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.deepEqual(body.data, {
      previousScore: 0,
      newScore: 5,
      delta: 5,
      totalVotes: 1,
    });
    assert.equal(memory.ratings[0].userId, null);
    assert.equal(memory.ratings[0].voterFingerprint, null);
    assert.equal(row.communityScore, 5);
    assert.equal(row.totalVotes, 1);
  });

  it('rejects authenticated CREATOR and ADMIN voters', async () => {
    for (const role of [Role.CREATOR, Role.ADMIN]) {
      const res = await app.inject({
        method: 'POST',
        url: rateUrl(),
        headers: { authorization: `Bearer ${token(role, CREATOR_ID)}` },
        payload: { rating: 3, voterFingerprint: 'device-a' },
      });
      assert.equal(res.statusCode, 403, role);
    }
  });

  it('rejects a second rating for the same video from the same IP identifier', async () => {
    const before = memory.ratings.length;
    const res = await app.inject({
      method: 'POST',
      url: rateUrl(),
      payload: { rating: 4, voterFingerprint: 'device-a' },
    });
    const body = JSON.parse(res.payload);
    assert.equal(res.statusCode, 409);
    assert.equal(body.success, false);
    assert.equal(body.message, 'You have already rated this video.');
    assert.equal(memory.ratings.length, before);
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  });

  it('allows the same IP identifier to rate a different video', async () => {
    const row = memory.submissions.get(VIDEO_B)!;
    row.communityScore = 0;
    row.totalVotes = 0;
    const res = await app.inject({
      method: 'POST',
      url: rateUrl(CONTEST_B, VIDEO_B),
      remoteAddress: '203.0.113.10',
      payload: { rating: 3 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(row.totalVotes, 1);
  });

  it('keeps one rating when two requests for the same video race', async () => {
    const row = memory.submissions.get(VIDEO_B)!;
    row.communityScore = 0;
    row.totalVotes = 0;
    memory.ratings = memory.ratings.filter((rating) => rating.submissionId !== VIDEO_B);
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: rateUrl(CONTEST_B, VIDEO_B),
        remoteAddress: '198.51.100.8',
        payload: { rating: 5 },
      }),
      app.inject({
        method: 'POST',
        url: rateUrl(CONTEST_B, VIDEO_B),
        remoteAddress: '198.51.100.8',
        payload: { rating: 1 },
      }),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(row.totalVotes, 1);
    const accepted = [first, second].find((response) => response.statusCode === 200);
    const duplicate = [first, second].find((response) => response.statusCode === 409);
    assert.equal(JSON.parse(duplicate!.payload).message, 'You have already rated this video.');
    assert.equal(row.communityScore, JSON.parse(accepted!.payload).data.newScore);
  });

  it('rounds 4.7 / 2 votes / rating 3 to 4.1', async () => {
    const row = memory.submissions.get(VIDEO_A)!;
    row.communityScore = 4.7;
    row.totalVotes = 2;
    const res = await app.inject({
      method: 'POST',
      url: rateUrl(),
      remoteAddress: '203.0.113.77',
      payload: { rating: 3 },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.payload).data, {
      previousScore: 4.7,
      newScore: 4.1,
      delta: -0.6,
      totalVotes: 3,
    });
  });

  it('rejects ratings when the contest is outside ACTIVE or JUDGING', async () => {
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.SCHEDULED));
    const scheduled = await app.inject({
      method: 'POST',
      url: rateUrl(),
      payload: { rating: 4 },
    });
    assert.equal(scheduled.statusCode, 409);

    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.ARCHIVED));
    const archived = await app.inject({
      method: 'POST',
      url: rateUrl(),
      payload: { rating: 4 },
    });
    assert.equal(archived.statusCode, 409);
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.ACTIVE));
  });

  it('rejects pending, rejected, and flagged submissions and a video from another contest', async () => {
    const pending = await app.inject({
      method: 'POST',
      url: rateUrl(CONTEST_A, VIDEO_PENDING),
      payload: { rating: 5 },
    });
    const rejected = await app.inject({
      method: 'POST',
      url: rateUrl(CONTEST_A, VIDEO_REJECTED),
      payload: { rating: 5 },
    });
    const flagged = await app.inject({
      method: 'POST',
      url: rateUrl(CONTEST_A, VIDEO_FLAGGED),
      payload: { rating: 5 },
    });
    const cross = await app.inject({
      method: 'POST',
      url: rateUrl(CONTEST_A, VIDEO_B),
      payload: { rating: 5 },
    });
    assert.equal(pending.statusCode, 409);
    assert.equal(rejected.statusCode, 409);
    assert.equal(flagged.statusCode, 409);
    assert.equal(cross.statusCode, 404);
    assert.equal(memory.submissions.get(VIDEO_PENDING)!.totalVotes, 0);
    assert.equal(memory.submissions.get(VIDEO_REJECTED)!.totalVotes, 0);
  });

  it('allows JUDGING and denies creator, brand admin, and super admin', async () => {
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.JUDGING));
    const judging = await app.inject({
      method: 'POST',
      url: rateUrl(),
      remoteAddress: '198.51.100.20',
      payload: { rating: 2 },
    });
    assert.equal(judging.statusCode, 200);

    for (const role of [Role.CREATOR, Role.ADMIN]) {
      const res = await app.inject({
        method: 'POST',
        url: rateUrl(),
        headers: { authorization: `Bearer ${token(role, CREATOR_ID)}` },
        payload: { rating: 2 },
      });
      assert.equal(res.statusCode, 403, role);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
    }
    memory.contests.set(CONTEST_A, contestRow(CONTEST_A, ContestStatus.ACTIVE));
  });

  it('returns 401 for an invalid token and 400 for an invalid rating', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: rateUrl(),
      headers: { authorization: 'Bearer not.a.token' },
      payload: { rating: 5 },
    });
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(Object.keys(JSON.parse(invalid.payload)).sort(), ENVELOPE_KEYS);

    for (const rating of [0, 6, 1.5]) {
      const res = await app.inject({
        method: 'POST',
        url: rateUrl(),
        payload: { rating },
      });
      assert.equal(res.statusCode, 400, String(rating));
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
    }
  });

});
