import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/config/database.js';
import { RecurringContestService } from '../../src/services/recurring-contest.service.js';
import { PledgeRecurrenceService } from '../../src/services/pledge-recurrence.service.js';
import { SubmissionService } from '../../src/services/submission.service.js';
import { ModerationService } from '../../src/services/moderation.service.js';
import { JudgingService } from '../../src/services/judging.service.js';
import { LeaderboardService } from '../../src/services/leaderboard.service.js';
import { PledgeFinalizationService } from '../../src/services/pledge-finalization.service.js';
import {
  buildSubmissionObjectKey,
  setStorageService,
  type StorageService,
} from '../../src/services/storage.service.js';
import { ConflictError, ForbiddenError } from '../../src/utils/response.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const isolated =
  process.env.PLEDGE_ISOLATED_DB === '1' &&
  /@(127\.0\.0\.1|localhost):55432\//.test(DATABASE_URL) &&
  DATABASE_URL.includes('/cos_pledge_isolated') &&
  !DATABASE_URL.includes('neon');

const SCORES = {
  passion: 8,
  storyline: 6,
  choreography: 7,
  'musical-score': 9,
};

describe('pledge isolated postgres', { skip: isolated ? false : 'isolated database not selected' }, () => {
  const adminId = randomUUID();
  const creatorId = randomUUID();
  const voterId = randomUUID();
  const now = new Date('2026-11-15T12:00:00.000Z');

  before(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ratings", "audit_logs", "comments", "notifications", "creator_activity_logs", "submissions", "contests", "users" RESTART IDENTITY CASCADE',
    );
    setStorageService({
      getPublicUrl: (objectKey: string) => `https://isolated-test.invalid/${objectKey}`,
      async createPresignedUpload() {
        throw new Error('S3 is disabled for isolated Pledge verification');
      },
    } as StorageService);
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `pledge-admin-${adminId}@isolated.test`, passwordHash: 'not-a-login', name: 'Pledge Admin', role: 'ADMIN' },
        { id: creatorId, email: `pledge-creator-${creatorId}@isolated.test`, passwordHash: 'not-a-login', name: 'Pledge Creator', role: 'CREATOR' },
        { id: voterId, email: `pledge-voter-${voterId}@isolated.test`, passwordHash: 'not-a-login', name: 'Pledge Voter', role: 'CREATOR' },
      ],
    });
  });

  it('keeps a frozen October row unchanged and freezes categories on the new month', async () => {
    const octoberId = randomUUID();
    const beforeCounts = await tokeCounts();
    await prisma.contest.create({
      data: {
        id: octoberId,
        title: 'Existing October',
        description: 'frozen-october-do-not-edit',
        status: 'JUDGING',
        timezone: 'UTC',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-11-01T00:00:00.000Z'),
        votingClosesAt: new Date('2026-11-01T00:00:00.000Z'),
        seriesSlug: 'pledge',
        cycleMonth: '2026-10',
        isRecurringMonthly: true,
        configFrozenAt: new Date('2026-10-01T00:00:00.000Z'),
        scoringCategories: Prisma.DbNull,
        rules: ['october-rule'],
      },
    });
    const octoberBefore = await prisma.contest.findUniqueOrThrow({ where: { id: octoberId } });

    const template = await RecurringContestService.create(adminId, {
      title: 'Pledge of aWEEEEEDgence',
      description: 'Monthly community video contest.',
      seriesSlug: 'pledge',
      rules: ['Self-voting is prohibited'],
      minOverallVoters: 10,
      minCategoryVoters: 5,
      scoringCategories: [
        { name: 'Passion', slug: 'passion', sortOrder: 1, enabled: true, weight: 1 },
        { name: 'Storyline', slug: 'storyline', sortOrder: 2, enabled: true, weight: 1 },
        { name: 'Choreography', slug: 'choreography', sortOrder: 3, enabled: true, weight: 1 },
        { name: 'Musical Score', slug: 'musical-score', sortOrder: 4, enabled: true, weight: 1 },
      ],
      combinedScoreEnabled: false,
      enabled: true,
    });
    assert.equal(template.categoriesCount, 4);

    const created = await PledgeRecurrenceService.ensureCurrentMonthlyContest(now);
    assert.ok(created);
    assert.equal(created.cycleMonth, '2026-11');
    assert.equal(created.scoringCategories?.map((category) => category.slug).join(','), 'passion,storyline,choreography,musical-score');
    const again = await PledgeRecurrenceService.ensureCurrentMonthlyContest(now);
    assert.equal(again?.id, created.id);

    await RecurringContestService.update(adminId, template.id, {
      scoringCategories: [{ name: 'Lighting', slug: 'lighting', sortOrder: 1, enabled: true, weight: 1 }],
    });
    const november = await prisma.contest.findUniqueOrThrow({ where: { id: created.id } });
    const octoberAfter = await prisma.contest.findUniqueOrThrow({ where: { id: octoberId } });
    const frozen = november.scoringCategories as Array<{ slug: string; name: string; enabled: boolean }>;
    assert.deepEqual(
      frozen.map((category) => [category.slug, category.name, category.enabled]),
      [
        ['passion', 'Passion', true],
        ['storyline', 'Storyline', true],
        ['choreography', 'Choreography', true],
        ['musical-score', 'Musical Score', true],
      ],
    );
    assert.equal(octoberAfter.scoringCategories, null);
    assert.equal(octoberAfter.title, octoberBefore.title);
    assert.equal(octoberAfter.description, octoberBefore.description);
    assert.equal(octoberAfter.status, octoberBefore.status);
    assert.deepEqual(octoberAfter.rules, octoberBefore.rules);
    assert.equal(octoberAfter.configFrozenAt?.toISOString(), octoberBefore.configFrozenAt?.toISOString());

    const approved = await enterAndModerate(created.id, creatorId, adminId, 'Approved clip');
    const rejected = await enterAndModerate(created.id, creatorId, adminId, 'Rejected clip', false);
    const highA = await enterAndModerate(created.id, creatorId, adminId, 'Tie A');
    const highB = await enterAndModerate(created.id, creatorId, adminId, 'Tie B');
    const queue = await JudgingService.getQueue(created.id);
    assert.equal(queue.items.some((item) => item.id === approved.id), true);
    assert.equal(queue.items.some((item) => item.id === rejected.id), false);

    await assert.rejects(
      JudgingService.rateSubmission(rate(created.id, approved.id, null, creatorId, 9)),
      ForbiddenError,
    );
    await JudgingService.rateSubmission(rate(created.id, approved.id, null, voterId, 6));
    await JudgingService.rateSubmission(rate(created.id, approved.id, null, voterId, 6));
    assert.equal(await prisma.rating.count({ where: { submissionId: approved.id, userId: voterId } }), 1);

    const guest = 'guest-update';
    await JudgingService.rateSubmission(rate(created.id, approved.id, guest, null, 5));
    await JudgingService.rateSubmission(rate(created.id, approved.id, guest, null, 6));
    assert.equal(await prisma.rating.count({ where: { submissionId: approved.id, guestVoterId: guest } }), 1);

    for (let index = 0; index < 8; index += 1) {
      await JudgingService.rateSubmission({
        ...rate(created.id, approved.id, `guest-a-${index}`, null, 6),
        voterIpHash: 'shared-ip',
      });
    }
    assert.equal(await prisma.rating.count({ where: { submissionId: approved.id, voterIpHash: 'shared-ip' } }), 8);
    for (let index = 0; index < 10; index += 1) {
      await JudgingService.rateSubmission(rate(created.id, highA.id, `guest-tie-a-${index}`, null, 9));
      await JudgingService.rateSubmission(rate(created.id, highB.id, `guest-tie-b-${index}`, null, 9));
    }
    const short = await enterAndModerate(created.id, creatorId, adminId, 'Short quorum');
    for (let index = 0; index < 4; index += 1) {
      await JudgingService.rateSubmission(rate(created.id, short.id, `guest-b-${index}`, null, 10));
    }

    await prisma.rating.create({
      data: {
        submissionId: approved.id,
        guestVoterId: 'guest-partial',
        voterIpHash: 'not-identity',
        rating: 10,
        categoryScores: { storyline: 10, choreography: 10, 'musical-score': 10 },
      },
    });

    const board = await LeaderboardService.getContestLeaderboard(created.id);
    const approvedRow = board.items.find((item) => item.id === approved.id);
    const shortRow = board.items.find((item) => item.id === short.id);
    assert.equal(approvedRow?.isQuorumQualified, true);
    assert.equal(shortRow?.isQuorumQualified, false);
    assert.equal(approvedRow?.distinctVoterCount, 11);
    const passion = board.categoryBoards?.find((category) => category.slug === 'passion');
    const passionApproved = passion?.items.find((item) => item.id === approved.id);
    const passionShort = passion?.items.find((item) => item.id === short.id);
    assert.equal(passionApproved?.eligible, true);
    assert.equal(passionApproved?.validRatingCount, 10);
    assert.equal(passionApproved?.average, 8);
    assert.equal(passionShort?.eligible, false);
    assert.equal(passionShort?.validRatingCount, 4);

    await prisma.contest.update({
      where: { id: created.id },
      data: { status: 'JUDGING', votingClosesAt: new Date('2026-10-01T00:00:00.000Z') },
    });
    await assert.rejects(
      JudgingService.rateSubmission(rate(created.id, approved.id, 'guest-late', null, 5)),
      ConflictError,
    );

    await assert.rejects(
      PledgeFinalizationService.finalizeMonthlyWinners(created.id, adminId, false, new Date('2026-11-20T00:00:00.000Z')),
      ConflictError,
    );
    const finalized = await PledgeFinalizationService.finalizeMonthlyWinners(
      created.id,
      adminId,
      true,
      new Date('2026-11-20T00:00:00.000Z'),
    );
    assert.equal(finalized.published, false);
    assert.equal(finalized.overall.winners.length, 2);
    const afterFinalize = await prisma.contest.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(afterFinalize.status, 'JUDGING');
    assert.equal((await PledgeFinalizationService.listPublicArchive(1, 20)).items.some((item) => item.contestId === created.id), false);

    await PledgeFinalizationService.publishMonthlyWinners(created.id);
    const published = await PledgeFinalizationService.listPublicArchive(1, 20);
    const archived = published.items.find((item) => item.contestId === created.id);
    assert.ok(archived);
    assert.equal(archived.winners.overall.winners.length, 2);
    assert.equal('revisions' in archived.winners, false);

    const corrected = await PledgeFinalizationService.correctWinner(
      created.id,
      adminId,
      'Second clip withdrew',
      [highA.id],
      new Date('2026-11-21T00:00:00.000Z'),
    );
    assert.equal(corrected.revisions.length, 1);
    assert.equal(corrected.revisions[0]?.previous?.overall.winners.length, 2);
    assert.equal(corrected.overall.winners.length, 1);
    const publicAfter = (await PledgeFinalizationService.listPublicArchive(1, 20)).items.find((item) => item.contestId === created.id);
    assert.equal(publicAfter?.winners.overall.winners.length, 1);
    assert.equal('revisions' in (publicAfter?.winners ?? {}), false);

    const afterCounts = await tokeCounts();
    assert.deepEqual(afterCounts, beforeCounts);
    const octoberFinal = await prisma.contest.findUniqueOrThrow({ where: { id: octoberId } });
    assert.equal(octoberFinal.scoringCategories, null);
    assert.equal(octoberFinal.title, 'Existing October');
  });
});

async function tokeCounts() {
  const [categories, reviews] = await Promise.all([
    prisma.reviewCategory.count(),
    prisma.productReview.count(),
  ]);
  return { categories, reviews };
}

function rate(
  contestId: string,
  videoId: string,
  guestVoterId: string | null,
  userId: string | null,
  rating: number,
) {
  return {
    contestId,
    videoId,
    rating,
    voter: userId ? { id: userId, role: 'CREATOR' as const } : null,
    voterFingerprint: null,
    voterIpHash: `ip-${guestVoterId ?? userId}`,
    guestVoterId,
    categoryScores: SCORES,
  };
}

async function enterAndModerate(
  contestId: string,
  creatorId: string,
  adminId: string,
  title: string,
  approve = true,
) {
  const created = await SubmissionService.complete(
    { id: creatorId, role: 'CREATOR' },
    {
      contestId,
      objectKey: buildSubmissionObjectKey({
        contestId,
        creatorId,
        contentType: 'video/mp4',
        objectId: randomUUID(),
      }),
        title,
        description: title,
        durationSeconds: 20,
        otherCategoryLabel: 'Pledge',
    },
  );
  assert.equal(created.submission.status, 'PENDING_REVIEW');
  const hidden = await JudgingService.getQueue(contestId);
  assert.equal(hidden.items.some((item) => item.id === created.submission.id), false);
  if (approve) {
    await ModerationService.approve({ id: adminId, role: 'ADMIN' }, created.submission.id);
  } else {
    await ModerationService.reject({ id: adminId, role: 'ADMIN' }, created.submission.id, 'Not a Pledge entry');
  }
  return created.submission;
}
