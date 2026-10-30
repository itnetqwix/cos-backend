import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus } from '@prisma/client';
import { publicArchiveSnapshot, type WinnerSnapshot } from '../../src/services/pledge-finalization.service.js';

function snapshot(cycleMonth: string): WinnerSnapshot {
  return {
    contestId: `contest-${cycleMonth}`,
    seriesSlug: 'pledge',
    cycleMonth,
    finalizedAt: `${cycleMonth}-28T00:00:00.000Z`,
    finalizedById: 'admin-1',
    certificationStatus: 'certified',
    version: 1,
    thresholds: { overallVoters: 10, categoryRatings: 5 },
    categoryNames: ['Comedy'],
    overall: {
      result: 'winners',
      message: null,
      winners: [
        {
          submissionId: 'sub-1',
          creatorId: 'creator-1',
          creatorName: 'Ada',
          title: 'Clip',
          videoUrl: 'https://example.com/clip.mp4',
          communityScore: 9.1,
          distinctVoterCount: 14,
          validRatingCount: 14,
          coWinner: false,
        },
      ],
      tiedCandidates: [],
    },
    categories: [],
    revisions: [
      {
        version: 0,
        at: '2026-01-01T00:00:00.000Z',
        adminId: 'admin-1',
        reason: 'internal',
        previous: null,
      },
    ],
  };
}

describe('pledge public archive', () => {
  it('returns the frozen public snapshot and omits correction history', () => {
    const published = publicArchiveSnapshot(snapshot('2026-10'));
    assert.equal(published.cycleMonth, '2026-10');
    assert.equal(published.overall.winners[0]?.creatorName, 'Ada');
    assert.equal(published.overall.winners[0]?.communityScore, 9.1);
    assert.equal('revisions' in published, false);
    assert.equal(published.seriesSlug, 'pledge');
  });

  it('keeps an explicit no-winner result', () => {
    const empty = snapshot('2026-09');
    empty.overall = {
      result: 'no-eligible-winner',
      message: 'No eligible winner this month',
      winners: [],
      tiedCandidates: [],
    };
    const published = publicArchiveSnapshot(empty);
    assert.equal(published.overall.result, 'no-eligible-winner');
    assert.equal(published.overall.message, 'No eligible winner this month');
    assert.equal(published.overall.winners.length, 0);
    assert.equal(ContestStatus.COMPLETED, 'COMPLETED');
  });
});
