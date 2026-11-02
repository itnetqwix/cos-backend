import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  manualWinnerSlots,
  PledgeFinalizationService,
  type PledgeCandidate,
  type FinalizableContest,
} from '../../src/services/pledge-finalization.service.js';
import { RecurringContestService, type RecurringStore } from '../../src/services/recurring-contest.service.js';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import { SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { RatingRepository } from '../../src/repositories/rating.repository.js';
import { ValidationError, ConflictError } from '../../src/utils/response.js';
import { ContestStatus } from '@prisma/client';

function makeCandidate(id: string, creatorId: string, name: string, score = 8.5): PledgeCandidate {
  return {
    submissionId: id,
    creatorId,
    creatorName: name,
    title: `Entry ${name}`,
    videoUrl: `https://example.com/${id}.mp4`,
    thumbnailUrl: `https://example.com/${id}.jpg`,
    categoryName: 'Comedy',
    communityScore: score,
    distinctVoterCount: 15,
    validRatingCount: 15,
  };
}

describe('Pledge Winner Count & Publication Validation', () => {
  const c1 = makeCandidate('11111111-1111-4111-8111-111111111111', 'creator-1', 'Alice', 9.5);
  const c2 = makeCandidate('22222222-2222-4222-8222-222222222222', 'creator-2', 'Bob', 9.0);
  const c3 = makeCandidate('33333333-3333-4333-8333-333333333333', 'creator-3', 'Charlie', 8.5);
  const c4 = makeCandidate('44444444-4444-4444-8444-444444444444', 'creator-4', 'David', 8.0);

  it('1. manualWinnerSlots: succeeds when candidates equal configured winner count', () => {
    const result = manualWinnerSlots({
      orderedIds: [c1.submissionId, c2.submissionId, c3.submissionId],
      candidates: [c1, c2, c3],
      winnerCount: 3,
    });
    assert.equal(result.winners.length, 3);
    assert.equal(result.winners[0]?.submissionId, c1.submissionId);
    assert.equal(result.winners[0]?.rank, 1);
    assert.equal(result.winners[0]?.badge, 'gold');
    assert.equal(result.winners[1]?.rank, 2);
    assert.equal(result.winners[1]?.badge, 'silver');
    assert.equal(result.winners[2]?.rank, 3);
    assert.equal(result.winners[2]?.badge, 'bronze');
    assert.equal(result.shortfallExplanation, null);
  });

  it('2. manualWinnerSlots: succeeds when valid candidates are fewer than configured count (e.g. 2 of 3)', () => {
    const result = manualWinnerSlots({
      orderedIds: [c1.submissionId, c2.submissionId],
      candidates: [c1, c2],
      winnerCount: 3,
    });
    assert.equal(result.winners.length, 2);
    assert.equal(result.winners[0]?.submissionId, c1.submissionId);
    assert.equal(result.winners[0]?.rank, 1);
    assert.equal(result.winners[1]?.submissionId, c2.submissionId);
    assert.equal(result.winners[1]?.rank, 2);
    assert.equal(result.shortfallExplanation, 'Admin selected 2 of 3 configured winners.');
  });

  it('3. manualWinnerSlots: fails when no winners are ranked', () => {
    assert.throws(
      () => {
        manualWinnerSlots({
          orderedIds: [],
          candidates: [c1, c2],
          winnerCount: 3,
        });
      },
      (err: unknown) => {
        assert(err instanceof ValidationError);
        assert.equal(err.message, 'No eligible nominated submissions selected');
        return true;
      }
    );
  });

  it('4. manualWinnerSlots: fails when ranked winners exceed configured winner count', () => {
    assert.throws(
      () => {
        manualWinnerSlots({
          orderedIds: [c1.submissionId, c2.submissionId, c3.submissionId, c4.submissionId],
          candidates: [c1, c2, c3, c4],
          winnerCount: 3,
        });
      },
      (err: unknown) => {
        assert(err instanceof ValidationError);
        assert.equal(err.message, 'Select at most 3 winners');
        return true;
      }
    );
  });

  it('5. manualWinnerSlots: fails when rank order contains duplicates', () => {
    assert.throws(
      () => {
        manualWinnerSlots({
          orderedIds: [c1.submissionId, c1.submissionId],
          candidates: [c1, c2],
          winnerCount: 3,
        });
      },
      (err: unknown) => {
        assert(err instanceof ValidationError);
        assert.equal(err.message, 'Each winner can be selected once');
        return true;
      }
    );
  });

  it('6. selectMonthlyWinners: fails when winner count is missing, null, or zero', async () => {
    const origFindById = ContestRepository.findById;
    try {
      ContestRepository.findById = async () => ({
        id: 'contest-oct-2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        status: ContestStatus.JUDGING,
        votingClosesAt: new Date(Date.now() - 3600_000),
        minOverallVoters: 10,
        minCategoryVoters: 5,
        isWinnersFinalized: false,
        winnersData: null,
        winnerCount: null, // MISSING
        rankingNeedsReview: false,
        scoringCategories: [],
        category: null,
      } as any);

      await assert.rejects(
        async () => {
          await PledgeFinalizationService.selectMonthlyWinners(
            'contest-oct-2026',
            'admin-1',
            [c1.submissionId],
            new Date()
          );
        },
        (err: unknown) => {
          assert(err instanceof ValidationError);
          assert.equal(err.message, 'Missing monthly winner-count configuration');
          return true;
        }
      );

      // Now with winnerCount = 0
      ContestRepository.findById = async () => ({
        id: 'contest-oct-2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        status: ContestStatus.JUDGING,
        votingClosesAt: new Date(Date.now() - 3600_000),
        minOverallVoters: 10,
        minCategoryVoters: 5,
        isWinnersFinalized: false,
        winnersData: null,
        winnerCount: 0, // INVALID
        rankingNeedsReview: false,
        scoringCategories: [],
        category: null,
      } as any);

      await assert.rejects(
        async () => {
          await PledgeFinalizationService.selectMonthlyWinners(
            'contest-oct-2026',
            'admin-1',
            [c1.submissionId],
            new Date()
          );
        },
        (err: unknown) => {
          assert(err instanceof ValidationError);
          assert.equal(err.message, 'Invalid winner-count configuration');
          return true;
        }
      );
    } finally {
      ContestRepository.findById = origFindById;
    }
  });

  it('7. selectMonthlyWinners: succeeds with fewer winners than configured (e.g. 2 candidates for 3-winner contest)', async () => {
    const origFindById = ContestRepository.findById;
    const origListApproved = SubmissionRepository.listApprovedForContest;
    const origListVoterRows = RatingRepository.listVoterRows;
    const origCertifyWinners = ContestRepository.certifyWinners;

    let certifiedSnapshot: any = null;

    try {
      ContestRepository.findById = async () => ({
        id: 'contest-oct-2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        status: ContestStatus.JUDGING,
        votingClosesAt: new Date(Date.now() - 3600_000),
        minOverallVoters: 10,
        minCategoryVoters: 5,
        isWinnersFinalized: false,
        winnersData: {
          teamEvaluations: {
            [c1.submissionId]: { nominated: true },
            [c2.submissionId]: { nominated: true },
          },
        },
        winnerCount: 3,
        rankingNeedsReview: false,
        scoringCategories: [],
        category: null,
      } as any);

      SubmissionRepository.listApprovedForContest = async () => [
        {
          id: c1.submissionId,
          creatorId: c1.creatorId,
          creator: { name: c1.creatorName },
          title: c1.title,
          videoUrl: c1.videoUrl,
          thumbnailUrl: c1.thumbnailUrl,
          contest: { category: null },
          communityScore: c1.communityScore,
          tags: [],
        } as any,
        {
          id: c2.submissionId,
          creatorId: c2.creatorId,
          creator: { name: c2.creatorName },
          title: c2.title,
          videoUrl: c2.videoUrl,
          thumbnailUrl: c2.thumbnailUrl,
          contest: { category: null },
          communityScore: c2.communityScore,
          tags: [],
        } as any,
      ];

      RatingRepository.listVoterRows = async () => [];
      ContestRepository.certifyWinners = async (_id, snapshot) => {
        certifiedSnapshot = snapshot;
        return {} as any;
      };

      const res = await PledgeFinalizationService.selectMonthlyWinners(
        'contest-oct-2026',
        'admin-1',
        [c1.submissionId, c2.submissionId],
        new Date()
      );

      assert.equal(res.overall.winners.length, 2);
      assert.equal(res.configuredWinnerCount, 3);
      assert.equal(res.shortfallExplanation, 'Admin selected 2 of 3 configured winners.');
      assert(certifiedSnapshot !== null);
    } finally {
      ContestRepository.findById = origFindById;
      SubmissionRepository.listApprovedForContest = origListApproved;
      RatingRepository.listVoterRows = origListVoterRows;
      ContestRepository.certifyWinners = origCertifyWinners;
    }
  });

  it('8. publishMonthlyWinners: validates winner count and prevents duplicate publishing', async () => {
    const origFindById = ContestRepository.findById;
    try {
      // 8a: Fails if winnerCount is missing
      ContestRepository.findById = async () => ({
        id: 'contest-oct-2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        status: ContestStatus.JUDGING,
        isWinnersFinalized: true,
        winnerCount: null,
        winnersData: { published: false, overall: { winners: [] } },
      } as any);

      await assert.rejects(
        async () => {
          await PledgeFinalizationService.publishMonthlyWinners('contest-oct-2026');
        },
        (err: unknown) => {
          assert(err instanceof ValidationError);
          assert.equal(err.message, 'Missing monthly winner-count configuration');
          return true;
        }
      );

      // 8b: Fails if already published
      ContestRepository.findById = async () => ({
        id: 'contest-oct-2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        status: ContestStatus.COMPLETED,
        isWinnersFinalized: true,
        winnerCount: 3,
        winnersData: { cycleMonth: '2026-10', published: true, overall: { winners: [] } },
      } as any);

      await assert.rejects(
        async () => {
          await PledgeFinalizationService.publishMonthlyWinners('contest-oct-2026');
        },
        (err: unknown) => {
          assert(err instanceof ConflictError);
          assert.equal(err.message, 'This month is already published');
          return true;
        }
      );
    } finally {
      ContestRepository.findById = origFindById;
    }
  });

  it('9. RecurringContestService.updateCycle: safe Admin correction for missing winner count preserves audit trail', async () => {
    const audits: any[] = [];
    let updatedRow: any = null;

    const mockCycle = {
      id: 'cycle-oct-2026',
      seriesSlug: 'pledge',
      cycleMonth: '2026-10',
      status: ContestStatus.JUDGING,
      title: 'Pledge October 2026',
      winnerCount: null, // missing!
      isRecurringMonthly: true,
      winnersPublished: false,
      submissionCount: 2,
      isWinnersFinalized: false,
      rankingNeedsReview: false,
      tagline: null,
      bannerUrl: null,
      bannerObjectKey: null,
      thumbnailUrl: null,
      description: 'October',
      rules: null,
      prizeSummary: null,
      autoAdvanceDelayMs: 1800,
      minOverallVoters: 10,
      minCategoryVoters: 5,
      configFrozenAt: new Date('2026-10-01'),
      scoringCategories: [],
      combinedScoreEnabled: false,
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      allowedVideoFormats: ['video/mp4'],
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-11-01'),
      votingClosesAt: new Date('2026-11-01'),
      category: null,
      categoryId: null,
    };

    const mockStore: RecurringStore = {
      listTemplates: async () => [],
      findById: async (id) => (id === mockCycle.id ? { ...mockCycle } : null),
      findTemplateBySlug: async () => null,
      listCycles: async () => [mockCycle],
      insert: async (r) => r,
      update: async (id, data) => {
        updatedRow = { ...mockCycle, ...data };
        return updatedRow;
      },
      remove: async () => {},
      categoryExists: async () => true,
      audit: async (entry) => {
        audits.push(entry);
      },
    };

    // Updating missing winnerCount on judging month should succeed
    const res = await RecurringContestService.updateCycle(
      'admin-user-1',
      'cycle-oct-2026',
      { winnerCount: 3 },
      new Date('2026-11-02'),
      mockStore
    );

    assert.equal(res.winnerCount, 3);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.actorId, 'admin-user-1');
    assert.equal(audits[0]?.action, 'RECURRENCE_UPDATE');
    assert.deepEqual(audits[0]?.metadata, {
      correction: 'CORRECT_WINNER_COUNT',
      cycleMonth: '2026-10',
      previousWinnerCount: null,
      newWinnerCount: 3,
    });

    // If winner count is already valid (3), attempting to change it on ACTIVE / JUDGING should be blocked
    const mockStoreFrozen: RecurringStore = {
      ...mockStore,
      findById: async () => ({ ...mockCycle, winnerCount: 3 }),
    };

    await assert.rejects(
      async () => {
        await RecurringContestService.updateCycle(
          'admin-user-1',
          'cycle-oct-2026',
          { winnerCount: 5 },
          new Date('2026-11-02'),
          mockStoreFrozen
        );
      },
      (err: unknown) => {
        assert(err instanceof ConflictError);
        assert(err.message.includes('cannot be changed for the current running month'));
        return true;
      }
    );
  });
});
