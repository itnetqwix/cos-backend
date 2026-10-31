import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContestStatus } from '@prisma/client';
import { ConflictError } from '../../src/utils/response.js';
import {
  assertPledgeFinalizable,
  buildWinnerSnapshot,
  correctWinnerSnapshot,
  publicArchiveSnapshot,
  selectConfiguredWinners,
  type FinalizableContest,
  type PledgeCandidate,
} from '../../src/services/pledge-finalization.service.js';

const now = new Date('2026-12-02T00:00:00.000Z');

function contest(partial: Partial<FinalizableContest> = {}): FinalizableContest {
  return {
    id: 'contest-1',
    seriesSlug: 'pledge',
    cycleMonth: '2026-11',
    status: ContestStatus.JUDGING,
    votingClosesAt: new Date('2026-12-01T00:00:00.000Z'),
    minOverallVoters: 10,
    minCategoryVoters: 5,
    isWinnersFinalized: false,
    winnersData: null,
    categoryName: 'Comedy',
    ...partial,
  };
}

function candidate(partial: Partial<PledgeCandidate>): PledgeCandidate {
  return {
    submissionId: 'sub-a',
    creatorId: 'creator-a',
    creatorName: 'Ada',
    title: 'Clip',
    videoUrl: 'https://example.com/a.mp4',
    categoryName: 'Comedy',
    communityScore: 8.2,
    distinctVoterCount: 12,
    validRatingCount: 12,
    ...partial,
  };
}

describe('pledge winner certification', () => {
  it('refuses an open contest and a second certification', () => {
    assert.throws(
      () => assertPledgeFinalizable(contest({ status: ContestStatus.ACTIVE }), now),
      ConflictError,
    );
    assert.throws(
      () => assertPledgeFinalizable(contest({ seriesSlug: null }), now),
      ConflictError,
    );
    assert.throws(
      () => assertPledgeFinalizable(contest({ isWinnersFinalized: true }), now),
      ConflictError,
    );
  });

  it('records no winner instead of lowering the quorum', () => {
    const { snapshot, tiePending } = buildWinnerSnapshot({
      contest: contest(),
      candidates: [candidate({ distinctVoterCount: 9, validRatingCount: 9 })],
      adminId: 'admin-1',
      now,
      acceptTies: false,
    });
    assert.equal(tiePending.length, 0);
    assert.equal(snapshot.overall.result, 'no-eligible-winner');
    assert.equal(snapshot.overall.message, 'No eligible winner this month');
    assert.equal(snapshot.overall.winners.length, 0);
    assert.equal(snapshot.thresholds.overallVoters, 10);
  });

  it('holds a tie until the admin certifies co-winners, then keeps a correction revision', () => {
    const tied = [
      candidate({ submissionId: 'sub-a', communityScore: 9, distinctVoterCount: 12 }),
      candidate({
        submissionId: 'sub-b',
        creatorId: 'creator-b',
        creatorName: 'Bea',
        communityScore: 9,
        distinctVoterCount: 12,
      }),
      candidate({
        submissionId: 'sub-c',
        communityScore: 8,
        distinctVoterCount: 20,
      }),
    ];
    const pending = buildWinnerSnapshot({
      contest: contest(),
      candidates: tied,
      adminId: 'admin-1',
      now,
      acceptTies: false,
    });
    assert.equal(pending.tiePending.length, 2);
    assert.equal(pending.snapshot.overall.winners.length, 0);

    const certified = buildWinnerSnapshot({
      contest: contest(),
      candidates: tied,
      adminId: 'admin-1',
      now,
      acceptTies: true,
    });
    assert.equal(certified.snapshot.overall.winners.length, 2);
    assert.equal(certified.snapshot.overall.winners.every((winner) => winner.coWinner), true);
    assert.equal(certified.snapshot.overall.winners.some((winner) => winner.submissionId === 'sub-c'), false);

    const corrected = correctWinnerSnapshot({
      current: certified.snapshot,
      adminId: 'admin-2',
      now,
      reason: 'Bea withdrew the clip',
      overallSubmissionIds: ['sub-a'],
    });
    assert.equal(corrected.version, 2);
    assert.equal(corrected.revisions.length, 1);
    assert.equal(corrected.revisions[0]?.reason, 'Bea withdrew the clip');
    assert.equal(corrected.revisions[0]?.previous?.overall.winners.length, 2);
    assert.equal(corrected.overall.winners.length, 1);
    assert.equal(publicArchiveSnapshot(corrected).revisions, undefined);
  });

  it('uses the configured winner count and does not fill the list with ineligible entries', () => {
    const eligible = Array.from({ length: 6 }, (_, index) =>
      candidate({
        submissionId: `sub-${index}`,
        creatorId: `creator-${index}`,
        communityScore: 10 - index,
        distinctVoterCount: 10,
      }),
    );
    const ineligible = candidate({
      submissionId: 'short',
      distinctVoterCount: 2,
      communityScore: 10,
    });
    const ten = selectConfiguredWinners(eligible, 10, false);
    assert.equal(ten.winners.length, 6);
    assert.equal(ten.winners.some((winner) => winner.submissionId === 'short'), false);
    assert.match(ten.shortfallExplanation ?? '', /fewer than the configured count of 10/);

    const five = selectConfiguredWinners(eligible, 5, false);
    assert.deepEqual(
      five.winners.map((winner) => winner.submissionId),
      ['sub-0', 'sub-1', 'sub-2', 'sub-3', 'sub-4'],
    );
    assert.equal(five.shortfallExplanation, null);

    const snapshot = buildWinnerSnapshot({
      contest: contest({ winnerCount: 5 }),
      candidates: [...eligible, ineligible],
      adminId: 'admin-1',
      now,
      acceptTies: false,
    });
    assert.equal(snapshot.snapshot.configuredWinnerCount, 5);
    assert.equal(snapshot.snapshot.overall.winners.length, 5);
    assert.equal(
      snapshot.snapshot.overall.winners.some((winner) => winner.submissionId === 'short'),
      false,
    );
  });
});
