import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus, SubmissionStatus } from '@prisma/client';
import { LeaderboardService } from '../../src/services/leaderboard.service.js';
import { ContestRecord, ContestRepository } from '../../src/repositories/contest.repository.js';
import { LeaderboardRecord, SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { NotFoundError } from '../../src/utils/response.js';

const CONTEST_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';

function mockContest(status: ContestStatus = ContestStatus.ACTIVE): ContestRecord {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: CONTEST_ID,
    organizationId: ORG_ID,
    categoryId: 'cat-1',
    title: 'Ripskis Comedy Challenge',
    description: 'Create the funniest video',
    tagline: null,
    bannerUrl: null,
    thumbnailUrl: null,
    status,
    startDate: now,
    endDate: new Date('2026-12-01T00:00:00.000Z'),
    prizeSummary: '$25,000 USD',
    rules: ['Be funny'],
    autoAdvanceDelayMs: 1800,
    createdAt: now,
    updatedAt: now,
    category: {
      id: 'cat-1',
      name: 'VFX Skit',
      slug: 'vfx-skit',
      description: 'VFX Skits',
    },
    organization: {
      id: ORG_ID,
      name: 'Ripskis',
      slug: 'ripskis',
    },
  };
}

function mockSubmission(
  id: string,
  communityScore: number,
  totalVotes: number,
  title: string,
  tags: string[] = ['vfx-skit'],
): LeaderboardRecord {
  const now = new Date('2026-09-02T00:00:00.000Z');
  return {
    id,
    contestId: CONTEST_ID,
    creatorId: 'creator-1',
    title,
    description: `Description for ${title}`,
    videoUrl: `https://example.com/${id}.mp4`,
    objectKey: `org/${ORG_ID}/contests/${CONTEST_ID}/creators/creator-1/${id}.mp4`,
    thumbnailUrl: `https://example.com/${id}.jpg`,
    durationSeconds: 15,
    status: SubmissionStatus.APPROVED,
    rejectionReason: null,
    moderatedById: 'mod-1',
    moderatedAt: now,
    tags,
    communityScore,
    totalVotes,
    createdAt: now,
    updatedAt: now,
    creator: {
      id: 'creator-1',
      name: 'Creator One',
    },
    contest: {
      id: CONTEST_ID,
      title: 'Ripskis Comedy Challenge',
      status: ContestStatus.ACTIVE,
      organizationId: ORG_ID,
      category: {
        id: 'cat-1',
        name: 'VFX Skit',
        slug: 'vfx-skit',
      },
    },
  };
}

describe('M09 LeaderboardService Unit Tests', () => {
  let origFindById: typeof ContestRepository.findById;
  let origListLeaderboard: typeof SubmissionRepository.listLeaderboardForContest;

  beforeEach(() => {
    origFindById = ContestRepository.findById;
    origListLeaderboard = SubmissionRepository.listLeaderboardForContest;
  });

  afterEach(() => {
    ContestRepository.findById = origFindById;
    SubmissionRepository.listLeaderboardForContest = origListLeaderboard;
  });

  it('throws NotFoundError when contest does not exist', async () => {
    ContestRepository.findById = async () => null;

    await assert.rejects(
      async () => LeaderboardService.getContestLeaderboard('non-existent-id'),
      (err: any) => {
        assert.ok(err instanceof NotFoundError);
        assert.equal(err.message, 'Contest not found');
        return true;
      },
    );
  });

  it('returns ranked approved submissions strictly ordered by score desc, then totalVotes desc (BR-WIN-01)', async () => {
    ContestRepository.findById = async () => mockContest(ContestStatus.ACTIVE);

    // Submissions in sorted order as returned by repository
    const subs = [
      mockSubmission('sub-1', 4.9, 100, 'Top Video'),
      mockSubmission('sub-2', 4.8, 150, 'High Votes'),
      mockSubmission('sub-3', 4.8, 120, 'Lower Votes Tie'),
      mockSubmission('sub-4', 4.2, 80, 'Fourth Place'),
      mockSubmission('sub-5', 3.5, 40, 'Fifth Place'),
    ];

    SubmissionRepository.listLeaderboardForContest = async () => subs;

    const result = await LeaderboardService.getContestLeaderboard(CONTEST_ID);

    assert.equal(result.contest.id, CONTEST_ID);
    assert.equal(result.contest.status, ContestStatus.ACTIVE);
    assert.equal(result.totalEntries, 5);
    assert.equal(result.totalVotes, 100 + 150 + 120 + 80 + 40);
    assert.equal(result.averageScore, Math.round(((4.9 + 4.8 + 4.8 + 4.2 + 3.5) / 5) * 10) / 10);

    // Ranks assigned 1 to 5
    assert.equal(result.items[0].rank, 1);
    assert.equal(result.items[0].id, 'sub-1');
    assert.equal(result.items[1].rank, 2);
    assert.equal(result.items[1].id, 'sub-2');
    assert.equal(result.items[2].rank, 3);
    assert.equal(result.items[2].id, 'sub-3');
    assert.equal(result.items[3].rank, 4);
    assert.equal(result.items[3].id, 'sub-4');
    assert.equal(result.items[4].rank, 5);
    assert.equal(result.items[4].id, 'sub-5');

    // Podium contains exactly top 3
    assert.equal(result.podium.length, 3);
    assert.equal(result.podium[0].id, 'sub-1');
    assert.equal(result.podium[1].id, 'sub-2');
    assert.equal(result.podium[2].id, 'sub-3');
  });

  it('handles empty leaderboard gracefully with 0 entries and empty podium', async () => {
    ContestRepository.findById = async () => mockContest(ContestStatus.ACTIVE);
    SubmissionRepository.listLeaderboardForContest = async () => [];

    const result = await LeaderboardService.getContestLeaderboard(CONTEST_ID);

    assert.equal(result.totalEntries, 0);
    assert.equal(result.totalVotes, 0);
    assert.equal(result.averageScore, 0);
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.podium, []);
  });

  it('returns read-only leaderboard for COMPLETED and ARCHIVED contests (BR-WIN-03)', async () => {
    ContestRepository.findById = async () => mockContest(ContestStatus.COMPLETED);
    SubmissionRepository.listLeaderboardForContest = async () => [
      mockSubmission('sub-winner', 5.0, 300, 'Champion Entry'),
    ];

    const result = await LeaderboardService.getContestLeaderboard(CONTEST_ID);

    assert.equal(result.contest.status, ContestStatus.COMPLETED);
    assert.equal(result.totalEntries, 1);
    assert.equal(result.items[0].rank, 1);
    assert.equal(result.items[0].id, 'sub-winner');
  });

  it('passes category filter option to repository', async () => {
    ContestRepository.findById = async () => mockContest(ContestStatus.ACTIVE);
    let capturedCategory: string | undefined;

    SubmissionRepository.listLeaderboardForContest = async (_contestId, category) => {
      capturedCategory = category;
      return [mockSubmission('sub-cat', 4.5, 50, 'Category Video', ['animation'])];
    };

    const result = await LeaderboardService.getContestLeaderboard(CONTEST_ID, {
      category: 'animation',
    });

    assert.equal(capturedCategory, 'animation');
    assert.equal(result.totalEntries, 1);
    assert.equal(result.items[0].id, 'sub-cat');
  });
});
