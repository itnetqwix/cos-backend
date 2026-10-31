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
import { ConflictError, ForbiddenError, ValidationError } from '../../src/utils/response.js';
import { PledgeCreatorHistoryService } from '../../src/services/pledge-creator-history.service.js';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import { presignReviewSchema } from '../../src/schemas/product-review.schema.js';

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

describe('pledge isolated postgres', { skip: isolated ? false : 'isolated database not selected', concurrency: 1 }, () => {
  const adminId = randomUUID();
  const creatorId = randomUUID();
  const voterId = randomUUID();
  const otherCreatorIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
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
        ...otherCreatorIds.map((id, index) => ({
          id,
          email: `pledge-creator-${index}-${id}@isolated.test`,
          passwordHash: 'not-a-login',
          name: `Pledge Creator ${index}`,
          role: 'CREATOR' as const,
        })),
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
      winnerCount: 2,
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
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
    const rejected = await enterAndModerate(created.id, otherCreatorIds[0], adminId, 'Rejected clip', false);
    const highA = await enterAndModerate(created.id, otherCreatorIds[1], adminId, 'Tie A');
    const highB = await enterAndModerate(created.id, otherCreatorIds[2], adminId, 'Tie B');
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
    const short = await enterAndModerate(created.id, otherCreatorIds[3], adminId, 'Short quorum');
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

  it('configures winner counts and upload limits per month and keeps one entry per creator', async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ratings", "audit_logs", "comments", "notifications", "creator_activity_logs", "submissions", "contests", "users" RESTART IDENTITY CASCADE',
    );
    let inspected: { contentLength: number; contentType: string | null } | null = null;
    setStorageService({
      getPublicUrl: (objectKey: string) => `https://isolated-test.invalid/${objectKey}`,
      async createPresignedUpload(request) {
        return {
          uploadUrl: 'https://isolated-test.invalid/upload',
          objectKey: request.objectKey,
          headers: { 'Content-Type': request.contentType },
          expiresInSeconds: 900,
          method: 'PUT' as const,
        };
      },
      async inspectUploadedObject() {
        return inspected;
      },
    });
    const adminId = randomUUID();
    const heroId = randomUUID();
    const rejectedCreatorId = randomUUID();
    const quietCreatorId = randomUUID();
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `${adminId}@isolated.test`, passwordHash: 'x', name: 'Admin', role: 'ADMIN' },
        { id: heroId, email: `${heroId}@isolated.test`, passwordHash: 'x', name: 'Hero', role: 'CREATOR' },
        { id: rejectedCreatorId, email: `${rejectedCreatorId}@isolated.test`, passwordHash: 'x', name: 'Rejected', role: 'CREATOR' },
        { id: quietCreatorId, email: `${quietCreatorId}@isolated.test`, passwordHash: 'x', name: 'Quiet', role: 'CREATOR' },
      ],
    });
    const categories = [
      { name: 'Passion', slug: 'passion', sortOrder: 1, enabled: true, weight: 1 },
    ];
    const template = await RecurringContestService.create(adminId, {
      title: 'Pledge of aWEEEEEDgence',
      description: 'Monthly community video contest.',
      seriesSlug: 'pledge',
      minOverallVoters: 1,
      minCategoryVoters: 1,
      winnerCount: 10,
      maxVideoSizeMb: 100,
      maxVideoDurationSeconds: 60,
      scoringCategories: categories,
      enabled: true,
    });
    const october = await PledgeRecurrenceService.ensureCurrentMonthlyContest(new Date('2026-10-15T12:00:00.000Z'));
    assert.ok(october);
    const hero = { id: heroId, role: 'CREATOR' as const };
    const within = await SubmissionService.presign(hero, {
      contestId: october.id,
      contentType: 'video/mp4',
      fileSizeBytes: 80 * 1024 * 1024,
      durationSeconds: 60,
    });
    await SubmissionService.complete(hero, {
      contestId: october.id,
      objectKey: within.objectKey,
      title: 'October hero',
      description: 'October hero',
      durationSeconds: 60,
      otherCategoryLabel: 'Pledge',
    });
    await assert.rejects(
      SubmissionService.presign(hero, {
        contestId: october.id,
        contentType: 'video/mp4',
        fileSizeBytes: 10 * 1024 * 1024,
        durationSeconds: 20,
      }),
      (error: unknown) => error instanceof ConflictError && /already submitted/.test(error.message),
    );
    await assert.rejects(
      SubmissionService.complete(hero, {
        contestId: october.id,
        objectKey: buildSubmissionObjectKey({
          contestId: october.id,
          creatorId: heroId,
          contentType: 'video/mp4',
          objectId: randomUUID(),
        }),
        title: 'Second October',
        description: 'Second October',
        durationSeconds: 20,
        otherCategoryLabel: 'Pledge',
      }),
      (error: unknown) => error instanceof ConflictError && /already submitted/.test(error.message),
    );
    const octoberMates: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const id = randomUUID();
      octoberMates.push(id);
      await prisma.user.create({
        data: { id, email: `${id}@isolated.test`, passwordHash: 'x', name: `October ${index}`, role: 'CREATOR' },
      });
      await enterAndModerate(october.id, id, adminId, `October ${index}`);
    }
    const rejected = await enterAndModerate(october.id, rejectedCreatorId, adminId, 'Rejected October', false);
    await RecurringContestService.update(adminId, template.id, {
      winnerCount: 5,
      maxVideoSizeMb: 50,
      maxVideoDurationSeconds: 45,
    });
    const november = await PledgeRecurrenceService.ensureCurrentMonthlyContest(new Date('2026-11-15T12:00:00.000Z'));
    assert.ok(november);
    const octoberRow = await prisma.contest.findUniqueOrThrow({ where: { id: october.id } });
    const novemberRow = await prisma.contest.findUniqueOrThrow({ where: { id: november.id } });
    assert.equal(octoberRow.winnerCount, 10);
    assert.equal(octoberRow.maxVideoSizeMb, 100);
    assert.equal(octoberRow.maxVideoDurationSeconds, 60);
    assert.equal(novemberRow.winnerCount, 5);
    assert.equal(novemberRow.maxVideoSizeMb, 50);
    assert.equal(novemberRow.maxVideoDurationSeconds, 45);
    await RecurringContestService.updateCycle(adminId, november.id, { description: 'november-only' });
    const octoberAfterEdit = await prisma.contest.findUniqueOrThrow({ where: { id: october.id } });
    assert.equal(octoberAfterEdit.description, octoberRow.description);
    assert.equal(octoberAfterEdit.winnerCount, 10);

    await assert.rejects(
      SubmissionService.presign(hero, {
        contestId: november.id,
        contentType: 'video/mp4',
        fileSizeBytes: 60 * 1024 * 1024,
        durationSeconds: 30,
      }),
      ValidationError,
    );
    await assert.rejects(
      SubmissionService.presign(hero, {
        contestId: november.id,
        contentType: 'video/mp4',
        fileSizeBytes: 20 * 1024 * 1024,
        durationSeconds: 50,
      }),
      ValidationError,
    );
    inspected = { contentLength: 51 * 1024 * 1024, contentType: 'video/mp4' };
    const oversizedKey = buildSubmissionObjectKey({
      contestId: november.id,
      creatorId: heroId,
      contentType: 'video/mp4',
      objectId: randomUUID(),
    });
    await assert.rejects(
      SubmissionService.complete(hero, {
        contestId: november.id,
        objectKey: oversizedKey,
        title: 'Too big',
        description: 'Too big',
        durationSeconds: 20,
        otherCategoryLabel: 'Pledge',
      }),
      ValidationError,
    );
    inspected = null;
    const novemberUpload = await SubmissionService.presign(hero, {
      contestId: november.id,
      contentType: 'video/mp4',
      fileSizeBytes: 40 * 1024 * 1024,
      durationSeconds: 45,
    });
    const novemberEntry = await SubmissionService.complete(hero, {
      contestId: november.id,
      objectKey: novemberUpload.objectKey,
      title: 'November hero',
      description: 'November hero',
      durationSeconds: 45,
      otherCategoryLabel: 'Pledge',
    });

    const novemberMates: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const id = randomUUID();
      novemberMates.push(id);
      await prisma.user.create({
        data: { id, email: `${id}@isolated.test`, passwordHash: 'x', name: `November ${index}`, role: 'CREATOR' },
      });
      await enterAndModerate(november.id, id, adminId, `November ${index}`);
    }
    const quiet = await enterAndModerate(november.id, quietCreatorId, adminId, 'Quiet November');
    await ModerationService.approve({ id: adminId, role: 'ADMIN' }, novemberEntry.submission.id);
    const heroOctober = await prisma.submission.findFirstOrThrow({
      where: { creatorId: heroId, contestId: october.id },
    });
    await ModerationService.approve({ id: adminId, role: 'ADMIN' }, heroOctober.id);

    const octoberEntries = [heroOctober.id, ...await idsFor(octoberMates, october.id)];
    for (let index = 0; index < octoberEntries.length; index += 1) {
      await JudgingService.rateSubmission(rate(october.id, octoberEntries[index], `oct-${index}`, null, 10 - index));
    }
    const novemberIds = await idsFor(novemberMates, november.id);
    for (let index = 0; index < novemberIds.length; index += 1) {
      await JudgingService.rateSubmission(rate(november.id, novemberIds[index], `nov-${index}`, null, 10 - index));
    }
    await JudgingService.rateSubmission(rate(november.id, novemberEntry.submission.id, 'nov-hero', null, 4));

    await RecurringContestService.updateCycle(adminId, october.id, { winnerCount: 9 });
    const flagged = await prisma.contest.findUniqueOrThrow({ where: { id: october.id } });
    assert.equal(flagged.rankingNeedsReview, true);
    assert.equal(novemberRow.winnerCount, 5);
    await RecurringContestService.updateCycle(adminId, october.id, { winnerCount: 10 });

    await closeMonth(october.id);
    await assert.rejects(
      PledgeFinalizationService.publishMonthlyWinners(october.id),
      ConflictError,
    );
    const octoberFinal = await PledgeFinalizationService.finalizeMonthlyWinners(
      october.id,
      adminId,
      false,
      new Date('2026-11-02T00:00:00.000Z'),
    );
    assert.equal(octoberFinal.configuredWinnerCount, 10);
    assert.equal(octoberFinal.overall.winners.length, 10);
    const pendingHistory = await PledgeCreatorHistoryService.listMine({ id: heroId, role: 'CREATOR' });
    const pendingOctober = pendingHistory.months.find((month) => month.cycleMonth === '2026-10');
    assert.equal(pendingOctober?.entries[0]?.resultMessage, 'Results pending');
    assert.equal(pendingOctober?.entries[0]?.winner, false);

    const publishedOctober = await PledgeFinalizationService.publishMonthlyWinners(october.id);
    assert.equal(publishedOctober.configuredWinnerCount, 10);
    assert.equal(publishedOctober.overall.winners.length, 10);
    const winnerHistory = await PledgeCreatorHistoryService.listMine({ id: heroId, role: 'CREATOR' });
    const winnerOctober = winnerHistory.months.find((month) => month.cycleMonth === '2026-10')?.entries[0];
    assert.equal(winnerOctober?.winner, true);
    assert.equal(winnerOctober?.finalRank, 1);
    const winnerNovember = winnerHistory.months.find((month) => month.cycleMonth === '2026-11')?.entries[0];
    assert.equal(winnerNovember?.resultMessage, 'Results pending');

    await closeMonth(november.id);
    const novemberFinal = await PledgeFinalizationService.finalizeMonthlyWinners(
      november.id,
      adminId,
      false,
      new Date('2026-12-02T00:00:00.000Z'),
    );
    assert.equal(novemberFinal.configuredWinnerCount, 5);
    assert.equal(novemberFinal.overall.winners.length, 5);
    assert.equal(
      novemberFinal.overall.winners.some((winner) => winner.submissionId === novemberEntry.submission.id),
      false,
    );
    assert.equal(
      novemberFinal.overall.winners.some((winner) => winner.submissionId === quiet.id),
      false,
    );
    await PledgeFinalizationService.publishMonthlyWinners(november.id);
    const after = await PledgeCreatorHistoryService.listMine({ id: heroId, role: 'CREATOR' });
    assert.deepEqual(
      after.months.map((month) => month.cycleMonth),
      ['2026-11', '2026-10'],
    );
    const novemberView = after.months[0]?.entries[0];
    assert.equal(novemberView?.winner, false);
    assert.match(String(novemberView?.resultMessage), /Overall community rating of 4\/10/);
    assert.match(String(novemberView?.resultMessage), /November/);
    assert.match(String(novemberView?.resultMessage), /not among this month's selected winners/);
    const rejectedHistory = await PledgeCreatorHistoryService.listMine({
      id: rejectedCreatorId,
      role: 'CREATOR',
    });
    assert.equal(rejectedHistory.months[0]?.entries[0]?.moderationStatus, 'REJECTED');
    assert.equal(rejectedHistory.months[0]?.entries[0]?.rejectionReason, 'Not a Pledge entry');
    const quietHistory = await PledgeCreatorHistoryService.listMine({
      id: quietCreatorId,
      role: 'CREATOR',
    });
    assert.equal(quietHistory.months[0]?.entries[0]?.resultState, 'insufficient');
    assert.match(String(quietHistory.months[0]?.entries[0]?.resultMessage), /enough community ratings/);
    assert.equal(quietHistory.months[0]?.entries[0]?.overallAverage, null);

    await RecurringContestService.update(adminId, template.id, {
      winnerCount: 3,
      maxVideoSizeMb: 40,
      maxVideoDurationSeconds: 30,
    });
    const december = await PledgeRecurrenceService.ensureCurrentMonthlyContest(new Date('2026-12-15T12:00:00.000Z'));
    assert.ok(december);
    assert.equal(december.winnerCount, 3);
    const octoberStill = await prisma.contest.findUniqueOrThrow({ where: { id: october.id } });
    const novemberStill = await prisma.contest.findUniqueOrThrow({ where: { id: november.id } });
    assert.equal(octoberStill.winnerCount, 10);
    assert.equal(octoberStill.maxVideoSizeMb, 100);
    assert.equal(novemberStill.winnerCount, 5);
    assert.equal(novemberStill.maxVideoSizeMb, 50);
    const loneId = randomUUID();
    await prisma.user.create({
      data: { id: loneId, email: `${loneId}@isolated.test`, passwordHash: 'x', name: 'Lone', role: 'CREATOR' },
    });
    const lone = await enterAndModerate(december.id, loneId, adminId, 'Only December');
    await JudgingService.rateSubmission(rate(december.id, lone.id, 'dec-lone', null, 8));
    const missedId = randomUUID();
    await prisma.user.create({
      data: { id: missedId, email: `${missedId}@isolated.test`, passwordHash: 'x', name: 'Missed', role: 'CREATOR' },
    });
    const missed = await enterAndModerate(december.id, missedId, adminId, 'Below quorum');
    await closeMonth(december.id);
    const decemberFinal = await PledgeFinalizationService.finalizeMonthlyWinners(
      december.id,
      adminId,
      false,
      new Date('2027-01-02T00:00:00.000Z'),
    );
    assert.equal(decemberFinal.overall.winners.length, 1);
    assert.equal(decemberFinal.configuredWinnerCount, 3);
    assert.match(decemberFinal.shortfallExplanation ?? '', /fewer than the configured count of 3/);
    assert.equal(
      decemberFinal.overall.winners.some((winner) => winner.submissionId === missed.id),
      false,
    );
    await assert.rejects(
      RecurringContestService.updateCycle(adminId, october.id, { winnerCount: 4 }),
      ConflictError,
    );

    const genericId = randomUUID();
    await prisma.contest.create({
      data: {
        id: genericId,
        title: 'Ordinary contest',
        description: 'Not Pledge',
        status: 'ACTIVE',
        timezone: 'UTC',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    const ordinary = { id: heroId, role: 'CREATOR' as const };
    await SubmissionService.presign(ordinary, {
      contestId: genericId,
      contentType: 'video/mp4',
      fileSizeBytes: 90 * 1024 * 1024,
      durationSeconds: 60,
    });
    await assert.rejects(
      SubmissionService.presign(ordinary, {
        contestId: genericId,
        contentType: 'video/mp4',
        fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
        durationSeconds: 30,
      }),
      ValidationError,
    );
    await assert.rejects(
      SubmissionService.presign(ordinary, {
        contestId: genericId,
        contentType: 'video/mp4',
        fileSizeBytes: 1024,
        durationSeconds: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS + 1,
      }),
      ValidationError,
    );
    presignReviewSchema.parse({
      contentType: 'video/mp4',
      fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES,
      durationSeconds: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS,
    });
    assert.throws(() =>
      presignReviewSchema.parse({
        contentType: 'video/mp4',
        fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
        durationSeconds: 30,
      }),
    );
  });
});

async function idsFor(creatorIds: string[], contestId: string) {
  const rows = await prisma.submission.findMany({
    where: { contestId, creatorId: { in: creatorIds } },
    select: { id: true, creatorId: true },
  });
  return creatorIds.map((creatorId) => {
    const row = rows.find((item) => item.creatorId === creatorId);
    if (!row) throw new Error(`missing submission for ${creatorId}`);
    return row.id;
  });
}

async function closeMonth(id: string) {
  await prisma.contest.update({
    where: { id },
    data: { status: 'JUDGING', votingClosesAt: new Date('2026-01-01T00:00:00.000Z') },
  });
}

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
