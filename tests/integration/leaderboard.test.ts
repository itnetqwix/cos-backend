import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { ContestStatus, SubmissionStatus } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { ContestRecord, ContestRepository } from '../../src/repositories/contest.repository.js';
import {
  LeaderboardRecord,
  SubmissionRepository,
} from '../../src/repositories/submission.repository.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const ORG_A = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const ORG_B = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const CONTEST_ACTIVE = '11111111-1111-4111-8111-111111111111';
const CONTEST_COMPLETED = '11111111-1111-4111-8111-111111111112';
const CONTEST_OTHER = '11111111-1111-4111-8111-111111111113';

const SUB_GOLD = '22222222-2222-4222-8222-222222222221';
const SUB_SILVER = '22222222-2222-4222-8222-222222222222';
const SUB_BRONZE = '22222222-2222-4222-8222-222222222223';
const SUB_FOURTH = '22222222-2222-4222-8222-222222222224';
const SUB_PENDING = '22222222-2222-4222-8222-222222222225';
const SUB_REJECTED = '22222222-2222-4222-8222-222222222226';
const SUB_FLAGGED = '22222222-2222-4222-8222-222222222227';
const SUB_OTHER_ORG = '22222222-2222-4222-8222-222222222228';

interface MemorySubmission {
  id: string;
  contestId: string;
  organizationId: string;
  status: SubmissionStatus;
  communityScore: number;
  totalVotes: number;
  createdAt: Date;
  title: string;
  tags: string[];
}

interface Memory {
  contests: Map<string, ContestRecord>;
  submissions: Map<string, MemorySubmission>;
}

function createMemory(): Memory {
  return {
    contests: new Map(),
    submissions: new Map(),
  };
}

function contestRow(
  id: string,
  organizationId: string,
  status: ContestStatus,
  title = 'Ripskis Open',
): ContestRecord {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id,
    organizationId,
    categoryId: 'cat-1',
    title,
    description: 'Contest description',
    tagline: null,
    bannerUrl: null,
    thumbnailUrl: null,
    status,
    startDate: now,
    endDate: new Date('2026-12-01T00:00:00.000Z'),
    prizeSummary: '$25,000 USD',
    rules: ['Rule 1'],
    autoAdvanceDelayMs: 1800,
    createdAt: now,
    updatedAt: now,
    category: { id: 'cat-1', name: 'Comedy Skit', slug: 'comedy-skit', description: null },
    organization: {
      id: organizationId,
      name: organizationId === ORG_A ? 'Ripskis' : 'Other Org',
      slug: organizationId === ORG_A ? 'ripskis' : 'other-org',
    },
  };
}

function toLeaderboardRecord(s: MemorySubmission): LeaderboardRecord {
  return {
    id: s.id,
    contestId: s.contestId,
    creatorId: 'creator-uuid',
    title: s.title,
    description: 'Submission description',
    videoUrl: `https://example.com/${s.id}.mp4`,
    objectKey: `org/${s.organizationId}/contests/${s.contestId}/creators/creator-uuid/${s.id}.mp4`,
    thumbnailUrl: `https://example.com/${s.id}.jpg`,
    durationSeconds: 15,
    status: s.status,
    rejectionReason: null,
    moderatedById: null,
    moderatedAt: null,
    tags: s.tags,
    communityScore: s.communityScore,
    totalVotes: s.totalVotes,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
    creator: { id: 'creator-uuid', name: 'Creator Name' },
    contest: {
      id: s.contestId,
      title: 'Ripskis Open',
      status: ContestStatus.ACTIVE,
      organizationId: s.organizationId,
      category: { id: 'cat-1', name: 'Comedy Skit', slug: 'comedy-skit' },
    },
  };
}

describe('M09 Leaderboard API Integration Tests', () => {
  let app: FastifyInstance;
  let memory: Memory;

  let origFindContestById: typeof ContestRepository.findById;
  let origListLeaderboard: typeof SubmissionRepository.listLeaderboardForContest;

  before(async () => {
    app = await buildApp();
    await app.ready();

    origFindContestById = ContestRepository.findById;
    origListLeaderboard = SubmissionRepository.listLeaderboardForContest;

    memory = createMemory();

    // Populate contests
    memory.contests.set(CONTEST_ACTIVE, contestRow(CONTEST_ACTIVE, ORG_A, ContestStatus.ACTIVE, 'Active Contest'));
    memory.contests.set(CONTEST_COMPLETED, contestRow(CONTEST_COMPLETED, ORG_A, ContestStatus.COMPLETED, 'Completed Contest'));
    memory.contests.set(CONTEST_OTHER, contestRow(CONTEST_OTHER, ORG_B, ContestStatus.ACTIVE, 'Other Org Contest'));

    // Populate submissions for CONTEST_ACTIVE
    // Gold: Score 4.9, Votes 100
    memory.submissions.set(SUB_GOLD, {
      id: SUB_GOLD,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.APPROVED,
      communityScore: 4.9,
      totalVotes: 100,
      createdAt: new Date('2026-09-02T10:00:00Z'),
      title: 'Gold Video',
      tags: ['comedy-skit', 'viral'],
    });

    // Silver: Score 4.8, Votes 200 (Tie-breaker on score 4.8 beats Bronze 150 votes)
    memory.submissions.set(SUB_SILVER, {
      id: SUB_SILVER,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.APPROVED,
      communityScore: 4.8,
      totalVotes: 200,
      createdAt: new Date('2026-09-02T11:00:00Z'),
      title: 'Silver Video',
      tags: ['comedy-skit', 'vfx'],
    });

    // Bronze: Score 4.8, Votes 150
    memory.submissions.set(SUB_BRONZE, {
      id: SUB_BRONZE,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.APPROVED,
      communityScore: 4.8,
      totalVotes: 150,
      createdAt: new Date('2026-09-02T12:00:00Z'),
      title: 'Bronze Video',
      tags: ['standup'],
    });

    // Fourth: Score 4.2, Votes 80
    memory.submissions.set(SUB_FOURTH, {
      id: SUB_FOURTH,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.APPROVED,
      communityScore: 4.2,
      totalVotes: 80,
      createdAt: new Date('2026-09-02T13:00:00Z'),
      title: 'Fourth Video',
      tags: ['comedy-skit'],
    });

    // Excluded non-approved submissions
    memory.submissions.set(SUB_PENDING, {
      id: SUB_PENDING,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.PENDING_REVIEW,
      communityScore: 5.0,
      totalVotes: 500,
      createdAt: new Date('2026-09-02T14:00:00Z'),
      title: 'Pending Video',
      tags: ['comedy-skit'],
    });

    memory.submissions.set(SUB_REJECTED, {
      id: SUB_REJECTED,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.REJECTED,
      communityScore: 5.0,
      totalVotes: 500,
      createdAt: new Date('2026-09-02T15:00:00Z'),
      title: 'Rejected Video',
      tags: ['comedy-skit'],
    });

    memory.submissions.set(SUB_FLAGGED, {
      id: SUB_FLAGGED,
      contestId: CONTEST_ACTIVE,
      organizationId: ORG_A,
      status: SubmissionStatus.FLAGGED,
      communityScore: 5.0,
      totalVotes: 500,
      createdAt: new Date('2026-09-02T16:00:00Z'),
      title: 'Flagged Video',
      tags: ['comedy-skit'],
    });

    // Other org submission
    memory.submissions.set(SUB_OTHER_ORG, {
      id: SUB_OTHER_ORG,
      contestId: CONTEST_OTHER,
      organizationId: ORG_B,
      status: SubmissionStatus.APPROVED,
      communityScore: 4.7,
      totalVotes: 90,
      createdAt: new Date('2026-09-02T17:00:00Z'),
      title: 'Other Org Video',
      tags: ['comedy-skit'],
    });

    // Mock repository implementations
    ContestRepository.findById = async (id: string) => memory.contests.get(id) ?? null;

    SubmissionRepository.listLeaderboardForContest = async (contestId: string, category?: string) => {
      const contest = memory.contests.get(contestId);
      if (!contest) return [];

      return Array.from(memory.submissions.values())
        .filter((s) => s.contestId === contestId && s.status === SubmissionStatus.APPROVED)
        .filter((s) => {
          if (!category || category === 'ALL') return true;
          return s.tags.includes(category) || contest.category?.slug === category || contest.category?.name.toLowerCase() === category.toLowerCase();
        })
        .sort((a, b) => {
          if (b.communityScore !== a.communityScore) {
            return b.communityScore - a.communityScore;
          }
          if (b.totalVotes !== a.totalVotes) {
            return b.totalVotes - a.totalVotes;
          }
          return a.id.localeCompare(b.id);
        })
        .map(toLeaderboardRecord);
    };
  });

  after(async () => {
    ContestRepository.findById = origFindContestById;
    SubmissionRepository.listLeaderboardForContest = origListLeaderboard;
    await app.close();
  });

  it('GET /api/v1/contests/:id/leaderboard is public and returns 200 with frozen envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_ACTIVE}/leaderboard`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, true);
    assert.equal(body.message, 'Leaderboard retrieved successfully');
    assert.equal(body.errors, null);
    assert.ok(body.data);
  });

  it('ranks APPROVED submissions strictly by communityScore desc then totalVotes desc (BR-WIN-01)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_ACTIVE}/leaderboard`,
    });

    assert.equal(res.statusCode, 200);
    const { data } = res.json();

    assert.equal(data.totalEntries, 4);
    assert.equal(data.items.length, 4);

    // Rank 1: Gold (Score 4.9, Votes 100)
    assert.equal(data.items[0].rank, 1);
    assert.equal(data.items[0].id, SUB_GOLD);
    assert.equal(data.items[0].communityScore, 4.9);
    assert.equal(data.items[0].totalVotes, 100);

    // Rank 2: Silver (Score 4.8, Votes 200 - tie break over Bronze)
    assert.equal(data.items[1].rank, 2);
    assert.equal(data.items[1].id, SUB_SILVER);
    assert.equal(data.items[1].communityScore, 4.8);
    assert.equal(data.items[1].totalVotes, 200);

    // Rank 3: Bronze (Score 4.8, Votes 150)
    assert.equal(data.items[2].rank, 3);
    assert.equal(data.items[2].id, SUB_BRONZE);
    assert.equal(data.items[2].communityScore, 4.8);
    assert.equal(data.items[2].totalVotes, 150);

    // Rank 4: Fourth (Score 4.2, Votes 80)
    assert.equal(data.items[3].rank, 4);
    assert.equal(data.items[3].id, SUB_FOURTH);
    assert.equal(data.items[3].communityScore, 4.2);
    assert.equal(data.items[3].totalVotes, 80);

    // Podium contains exactly top 3
    assert.equal(data.podium.length, 3);
    assert.equal(data.podium[0].id, SUB_GOLD);
    assert.equal(data.podium[1].id, SUB_SILVER);
    assert.equal(data.podium[2].id, SUB_BRONZE);
  });

  it('purges and excludes REJECTED, PENDING_REVIEW, and FLAGGED submissions (BR-WIN-02)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_ACTIVE}/leaderboard`,
    });

    assert.equal(res.statusCode, 200);
    const { data } = res.json();

    const ids = data.items.map((i: any) => i.id);
    assert.ok(!ids.includes(SUB_PENDING), 'Pending submission must be excluded');
    assert.ok(!ids.includes(SUB_REJECTED), 'Rejected submission must be excluded');
    assert.ok(!ids.includes(SUB_FLAGGED), 'Flagged submission must be excluded');
    assert.ok(!ids.includes(SUB_OTHER_ORG), 'Other contest submission must be excluded');
  });

  it('does not leak internal fields (objectKey, passwordHash, moderatedById)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_ACTIVE}/leaderboard`,
    });

    assert.equal(res.statusCode, 200);
    const { data } = res.json();

    for (const item of data.items) {
      assert.equal(item.objectKey, undefined);
      assert.equal(item.passwordHash, undefined);
      assert.equal(item.moderatedById, undefined);
      assert.equal(item.rejectionReason, undefined);
    }
  });

  it('returns 200 with empty items for contest with no approved submissions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_COMPLETED}/leaderboard`,
    });

    assert.equal(res.statusCode, 200);
    const { data } = res.json();
    assert.equal(data.totalEntries, 0);
    assert.equal(data.totalVotes, 0);
    assert.equal(data.averageScore, 0);
    assert.deepEqual(data.items, []);
    assert.deepEqual(data.podium, []);
    assert.equal(data.contest.status, ContestStatus.COMPLETED);
  });

  it('returns 404 for unknown contest id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contests/99999999-9999-4999-8999-999999999999/leaderboard',
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Contest not found');
    assert.equal(body.data, null);
  });

  it('returns 400 for invalid contest UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contests/not-a-uuid/leaderboard',
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });

  it('filters by category query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${CONTEST_ACTIVE}/leaderboard?category=vfx`,
    });

    assert.equal(res.statusCode, 200);
    const { data } = res.json();
    assert.equal(data.totalEntries, 1);
    assert.equal(data.items[0].id, SUB_SILVER);
    assert.equal(data.items[0].rank, 1);
  });
});
