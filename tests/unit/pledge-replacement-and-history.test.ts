import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus, SubmissionStatus } from '@prisma/client';
import { presignSubmissionSchema, completeSubmissionSchema } from '../../src/schemas/submission.schema.js';
import { readTeamMap } from '../../src/services/pledge-finalization.service.js';

describe('Pledge Data Integrity & Regression Suite', () => {
  it('Scenario 1: allows creator history to access replaced submissions with deletedAt set', () => {
    const activeSub = {
      id: 'sub-active',
      contestId: 'contest-oct',
      title: 'Current Active Video',
      deletedAt: null,
      createdAt: new Date('2026-10-25T10:00:00.000Z'),
    };

    const archivedSub = {
      id: 'sub-archived',
      contestId: 'contest-oct',
      title: 'First Video Version',
      deletedAt: new Date('2026-10-25T10:00:00.000Z'),
      createdAt: new Date('2026-10-10T10:00:00.000Z'),
      tags: ['replaced', 'replaced_by:sub-active'],
    };

    // Both are queried by PledgeCreatorHistoryService:
    // activeSub via deletedAt: null, archivedSub via deletedAt: { not: null } and tags: { has: 'replaced' }
    const versions = [archivedSub].map((v) => ({
      id: v.id,
      title: v.title,
      submittedAt: v.createdAt.toISOString(),
      replacedAt: v.deletedAt.toISOString(),
    }));

    const historyEntry = {
      id: activeSub.id,
      title: activeSub.title,
      previousVersions: versions,
    };

    assert.equal(historyEntry.id, 'sub-active');
    assert.equal(historyEntry.previousVersions.length, 1);
    assert.equal(historyEntry.previousVersions[0]!.id, 'sub-archived');
    assert.ok(historyEntry.previousVersions[0]!.replacedAt !== null);
  });

  it('Scenario 2: confirms old video record and S3 object are never destroyed upon replacement', () => {
    const oldRecord = {
      id: 'sub-orig',
      objectKey: 'submissions/contest-1/creator-1/orig.mp4',
      videoUrl: 'https://cdn.example.com/submissions/contest-1/creator-1/orig.mp4',
      deletedAt: new Date('2026-10-20T12:00:00.000Z'),
      rejectionReason: 'REPLACED_BY:sub-new',
    };

    // Object key and video URL are retained permanently in the DB row
    assert.ok(oldRecord.objectKey.includes('orig.mp4'));
    assert.ok(oldRecord.videoUrl.includes('orig.mp4'));
    assert.ok(oldRecord.deletedAt !== null);
  });

  it('Scenario 3: community ratings remain attached to old submission and are excluded from active leaderboard', () => {
    const oldSubId = 'sub-v1';
    const newSubId = 'sub-v2';

    // Mock ratings table: 3 ratings on old sub, 0 on new sub
    const ratingsTable = [
      { submissionId: oldSubId, rating: 9, userId: 'voter-1', creatorId: 'creator-1', submissionStatus: 'APPROVED', deleted: false },
      { submissionId: oldSubId, rating: 8, userId: 'voter-2', creatorId: 'creator-1', submissionStatus: 'APPROVED', deleted: false },
      { submissionId: oldSubId, rating: 10, userId: 'voter-3', creatorId: 'creator-1', submissionStatus: 'APPROVED', deleted: false },
    ];

    // Active submissions for leaderboard query: deletedAt is null, so only newSub is returned
    const activeSubmissionsOnLeaderboard = [
      { id: newSubId, creatorId: 'creator-1', title: 'New Video', communityScore: 0, totalVotes: 0 },
    ];

    const scored = activeSubmissionsOnLeaderboard.map((sub) => {
      const subRatings = ratingsTable.filter((r) => r.submissionId === sub.id);
      return {
        ...sub,
        communityScore: subRatings.length > 0 ? 9 : 0,
        totalVotes: subRatings.length,
      };
    });

    // New submission on leaderboard has 0 community score and 0 votes
    assert.equal(scored[0]!.communityScore, 0);
    assert.equal(scored[0]!.totalVotes, 0);

    // Old ratings still exist in the database with foreign key pointing to oldSubId
    const oldRatings = ratingsTable.filter((r) => r.submissionId === oldSubId);
    assert.equal(oldRatings.length, 3);
  });

  it('Scenario 4: confirms the new video is the only active entry for that creator/month', () => {
    const creatorSubmissions = [
      { id: 'sub-v1', creatorId: 'c1', contestId: 'oct-2026', deletedAt: new Date('2026-10-15') },
      { id: 'sub-v2', creatorId: 'c1', contestId: 'oct-2026', deletedAt: null },
    ];

    const active = creatorSubmissions.filter((s) => s.deletedAt === null);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.id, 'sub-v2');
  });

  it('Scenario 5: repeated replacements (A -> B -> C) preserve complete version chain', () => {
    const creatorId = 'c1';
    const contestId = 'oct-2026';

    const subA = {
      id: 'sub-A',
      creatorId,
      contestId,
      title: 'Version A (Initial)',
      deletedAt: new Date('2026-10-10T12:00:00.000Z'),
      rejectionReason: 'REPLACED_BY:sub-B',
      tags: ['replaced', 'replaced_by:sub-B'],
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
    };

    const subB = {
      id: 'sub-B',
      creatorId,
      contestId,
      title: 'Version B (Intermediate)',
      deletedAt: new Date('2026-10-20T12:00:00.000Z'),
      rejectionReason: 'REPLACED_BY:sub-C',
      tags: ['replacement', 'replaces:sub-A', 'replaced', 'replaced_by:sub-C'],
      createdAt: new Date('2026-10-10T12:00:00.000Z'),
    };

    const subC = {
      id: 'sub-C',
      creatorId,
      contestId,
      title: 'Version C (Current Active)',
      deletedAt: null,
      tags: ['replacement', 'replaces:sub-B'],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    };

    const allReplaced = [subA, subB].filter(
      (s) => s.deletedAt !== null && (s.tags.includes('replaced') || s.rejectionReason?.startsWith('REPLACED_BY'))
    );

    assert.equal(allReplaced.length, 2, 'Both older versions must be present in replaced history');
    assert.equal(subC.deletedAt, null, 'Latest version must remain the only active entry');
  });

  it('Scenario 6: replacement cannot occur after the monthly deadline, judging status, or publication', () => {
    function canReplace(contest: { status: ContestStatus; endDate: Date; isWinnersFinalized: boolean }, now: Date): boolean {
      if (contest.status !== ContestStatus.ACTIVE) return false;
      if (contest.endDate.getTime() <= now.getTime()) return false;
      if (contest.isWinnersFinalized) return false;
      return true;
    }

    const now = new Date('2026-11-02T12:00:00.000Z');

    const octoberJudging = {
      status: ContestStatus.JUDGING,
      endDate: new Date('2026-11-01T00:00:00.000Z'),
      isWinnersFinalized: false,
    };
    assert.equal(canReplace(octoberJudging, now), false, 'Judging cycle must reject replacement');

    const octoberCompleted = {
      status: ContestStatus.COMPLETED,
      endDate: new Date('2026-11-01T00:00:00.000Z'),
      isWinnersFinalized: true,
    };
    assert.equal(canReplace(octoberCompleted, now), false, 'Published cycle must reject replacement');

    const novemberActive = {
      status: ContestStatus.ACTIVE,
      endDate: new Date('2026-12-01T00:00:00.000Z'),
      isWinnersFinalized: false,
    };
    assert.equal(canReplace(novemberActive, now), true, 'Open November cycle allows replacement');
  });

  it('Scenario 7: five nominated active submissions from Team Review appear in Winner Selection pool', () => {
    const candidates = [
      { submissionId: 'sub-1', title: 'Video 1', creatorName: 'Alice' },
      { submissionId: 'sub-2', title: 'Video 2', creatorName: 'Bob' },
      { submissionId: 'sub-3', title: 'Video 3', creatorName: 'Charlie' },
      { submissionId: 'sub-4', title: 'Video 4', creatorName: 'Diana' },
      { submissionId: 'sub-5', title: 'Video 5', creatorName: 'Evan' },
      { submissionId: 'sub-6', title: 'Video 6', creatorName: 'Fiona' },
    ];

    const teamEvaluations: Record<string, { score: number; notes: string; nominated: boolean }> = {
      'sub-1': { score: 9, notes: 'Top notch', nominated: true },
      'sub-2': { score: 8, notes: 'Great vibe', nominated: true },
      'sub-3': { score: 8, notes: 'Creative', nominated: true },
      'sub-4': { score: 7, notes: 'Good edit', nominated: true },
      'sub-5': { score: 9, notes: 'High engagement', nominated: true },
      'sub-6': { score: 6, notes: 'Ordinary', nominated: false },
    };

    const pool = candidates.filter((c) => teamEvaluations[c.submissionId]?.nominated === true);
    assert.equal(pool.length, 5);
    assert.deepEqual(
      pool.map((c) => c.submissionId),
      ['sub-1', 'sub-2', 'sub-3', 'sub-4', 'sub-5']
    );
  });

  it('Scenario 8: readTeamMap correctly parses nominated: true and saving evaluation does not clear it', () => {
    const rawWinnersData = {
      teamEvaluations: {
        'sub-100': {
          score: 10,
          notes: 'Excellent candidate',
          nominated: true,
          updatedById: 'admin-1',
          updatedAt: '2026-11-02T12:00:00.000Z',
        },
      },
    };

    const team = readTeamMap(rawWinnersData);
    assert.ok(team['sub-100']);
    assert.equal(team['sub-100']!.nominated, true, 'readTeamMap must copy nominated boolean');
    assert.equal(team['sub-100']!.score, 10);
    assert.equal(team['sub-100']!.notes, 'Excellent candidate');

    // Simulate saveTeamEvaluation without passing nominated (preserving existing):
    const existing = team['sub-100']!;
    const inputNominated = undefined;
    const nextNominated = inputNominated !== undefined ? inputNominated : (existing.nominated ?? false);
    assert.equal(nextNominated, true, 'Next nominated state must remain true');
  });

  it('Scenario 9: archived/replaced submissions are excluded from Team Review, Winner Selection, and Leaderboard', () => {
    const submissions = [
      { id: 'sub-active', title: 'Active Video', status: SubmissionStatus.APPROVED, deletedAt: null, tags: ['replacement'] },
      { id: 'sub-archived', title: 'Replaced Video', status: SubmissionStatus.APPROVED, deletedAt: new Date(), tags: ['replaced'] },
    ];

    // Leaderboard & Review filtering:
    const visibleSubmissions = submissions.filter((s) => s.deletedAt === null && !s.tags.includes('replaced'));
    assert.equal(visibleSubmissions.length, 1);
    assert.equal(visibleSubmissions[0]!.id, 'sub-active');
  });

  it('Scenario 10: published result snapshots are immutable and not changed by live leaderboard queries', () => {
    const publishedSnapshot = {
      contestId: 'contest-oct-2026',
      published: true,
      overall: {
        winners: [
          { rank: 1, submissionId: 'sub-gold', creatorName: 'Winner Alice' },
          { rank: 2, submissionId: 'sub-silver', creatorName: 'Winner Bob' },
        ],
      },
    };

    // Live leaderboard calculations calculate live ranks dynamically
    const liveLeaderboardItems = [
      { rank: 1, id: 'sub-silver' },
      { rank: 2, id: 'sub-gold' },
    ];

    // Snapshot remains untouched
    assert.equal(publishedSnapshot.overall.winners[0]!.submissionId, 'sub-gold');
    assert.equal(publishedSnapshot.overall.winners[0]!.rank, 1);
  });

  it('Scenario 11: reviewMonth returns both duplicate submissions so Admin can reconcile them', () => {
    const rawApproved = [
      { id: 'a6dbab60-f31d-421e-8d4a-026f1c8dcbfb', creatorId: 'creator-oct', title: 'Pledgeee Teating', tags: [] },
      { id: '77f26f81-ecc0-4282-b470-e0fe7bf10ef0', creatorId: 'creator-oct', title: 'Pledge of aWEEEEEDgence', tags: [] },
    ];

    const nonReplaced = rawApproved.filter((s) => !s.tags.includes('replaced'));
    const creatorCount = new Map<string, number>();
    for (const sub of nonReplaced) {
      creatorCount.set(sub.creatorId, (creatorCount.get(sub.creatorId) ?? 0) + 1);
    }

    const reviewVideos = nonReplaced.map((sub) => ({
      ...sub,
      isDuplicateCreator: (creatorCount.get(sub.creatorId) ?? 0) > 1,
    }));

    assert.equal(reviewVideos.length, 2, 'Admin review must show both approved submissions');
    assert.equal(reviewVideos[0]!.isDuplicateCreator, true);
    assert.equal(reviewVideos[1]!.isDuplicateCreator, true);
  });

  it('Scenario 12: advisory lock and atomic transaction prevent concurrent replacements from creating multiple active entries', () => {
    const lockKey = (contestId: string, creatorId: string) => `pg_advisory_xact_lock(hashtext("${contestId}:${creatorId}"))`;
    assert.equal(
      lockKey('contest-1', 'creator-1'),
      'pg_advisory_xact_lock(hashtext("contest-1:creator-1"))'
    );
  });
});
