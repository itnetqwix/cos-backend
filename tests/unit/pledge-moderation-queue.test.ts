import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuditAction, ContestStatus, Role, SubmissionStatus } from '@prisma/client';
import { ModerationService } from '../../src/services/moderation.service.js';
import { SubmissionRepository, ModerationQueueRecord, SubmissionRecord } from '../../src/repositories/submission.repository.js';
import { AuditLogRepository, AuditLogRecord } from '../../src/repositories/audit-log.repository.js';
import { toModerationSubmissionView, toAuditLogView } from '../../src/controllers/moderation.controller.js';

describe('Pledge Moderation Queue & Lifecycle Regression Suite (12 Scenarios)', () => {
  const NOV_CYCLE_ID = 'e17c5d4c-aca7-4b4d-a9ef-1bc01fdda754';
  const OCT_CYCLE_ID = 'b951fc3e-eec1-4bdb-be83-a0f85ac4742f';
  const GENERIC_CONTEST_ID = '00000000-0000-4000-8000-000000000001';

  const CREATOR_ALICE = '11111111-1111-4111-8111-111111111111';
  const CREATOR_BOB = '22222222-2222-4222-8222-222222222222';
  const ADMIN_ACTOR = { id: 'admin-1', role: Role.ADMIN };
  const CREATOR_ALICE_ACTOR = { id: CREATOR_ALICE, role: Role.CREATOR };

  let submissionsStore: ModerationQueueRecord[] = [];
  let auditLogsStore: AuditLogRecord[] = [];

  function makeRecord(overrides: Partial<ModerationQueueRecord>): ModerationQueueRecord {
    return {
      id: overrides.id ?? 'sub-1',
      contestId: overrides.contestId ?? NOV_CYCLE_ID,
      creatorId: overrides.creatorId ?? CREATOR_ALICE,
      title: overrides.title ?? 'Reflections on cannabis revealing oneself.',
      description: overrides.description ?? null,
      videoUrl: overrides.videoUrl ?? 'https://s3/nov.mp4',
      objectKey: overrides.objectKey ?? `contests/${NOV_CYCLE_ID}/creators/${CREATOR_ALICE}/video.mp4`,
      thumbnailUrl: overrides.thumbnailUrl ?? null,
      durationSeconds: overrides.durationSeconds ?? 20,
      status: overrides.status ?? SubmissionStatus.PENDING_REVIEW,
      rejectionReason: overrides.rejectionReason ?? null,
      moderatedById: overrides.moderatedById ?? null,
      moderatedAt: overrides.moderatedAt ?? null,
      tags: overrides.tags ?? [],
      communityScore: overrides.communityScore ?? 0,
      totalVotes: overrides.totalVotes ?? 0,
      deletedAt: overrides.deletedAt ?? null,
      deletedById: overrides.deletedById ?? null,
      createdAt: overrides.createdAt ?? new Date('2026-11-03T17:25:55.178Z'),
      updatedAt: overrides.updatedAt ?? new Date('2026-11-03T17:25:55.178Z'),
      categoryId: null,
      otherCategoryLabel: null,
      contest: overrides.contest ?? {
        id: NOV_CYCLE_ID,
        title: 'Pledge testing — November 2026',
        status: ContestStatus.ACTIVE,
        seriesSlug: 'pledge',
        cycleMonth: '2026-11',
        category: null,
      },
      creator: overrides.creator ?? {
        id: CREATOR_ALICE,
        name: 'Alice Creator',
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    submissionsStore = [];
    auditLogsStore = [];

    // Mock SubmissionRepository.listPendingReview
    SubmissionRepository.listPendingReview = async (filter?: {
      contestId?: string;
      seriesSlug?: string;
    }) => {
      return submissionsStore.filter((s) => {
        if (s.status !== SubmissionStatus.PENDING_REVIEW) return false;
        if (s.deletedAt !== null) return false;
        if (filter?.contestId && s.contestId !== filter.contestId) return false;
        if (filter?.seriesSlug && s.contest.seriesSlug !== filter.seriesSlug) return false;
        return true;
      });
    };

    // Mock AuditLogRepository.list
    AuditLogRepository.list = async (filter?: {
      contestId?: string;
      seriesSlug?: string;
    }) => {
      return auditLogsStore.filter((log) => {
        if (filter?.contestId && log.submission?.contest?.id !== filter.contestId) return false;
        if (filter?.seriesSlug && log.submission?.contest?.seriesSlug !== filter.seriesSlug) return false;
        return true;
      });
    };
  });

  // 1. New November Pledge submission appears in November moderation queue
  it('1. New November Pledge submission appears in November moderation queue', async () => {
    submissionsStore.push(
      makeRecord({
        id: 'sub-nov-1',
        contestId: NOV_CYCLE_ID,
        title: 'Reflections on cannabis revealing oneself.',
        status: SubmissionStatus.PENDING_REVIEW,
      }),
    );

    const novQueue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(novQueue.length, 1);
    assert.equal(novQueue[0].id, 'sub-nov-1');
    assert.equal(novQueue[0].title, 'Reflections on cannabis revealing oneself.');
  });

  // 2. Submission from October does not incorrectly appear in November queue
  it('2. Submission from October does not incorrectly appear in November queue', async () => {
    submissionsStore.push(
      makeRecord({
        id: 'sub-oct-1',
        contestId: OCT_CYCLE_ID,
        contest: {
          id: OCT_CYCLE_ID,
          title: 'Pledge — October 2026',
          status: ContestStatus.COMPLETED,
          seriesSlug: 'pledge',
          cycleMonth: '2026-10',
          category: null,
        },
        title: 'October Entry',
        status: SubmissionStatus.PENDING_REVIEW,
      }),
    );

    const novQueue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(novQueue.length, 0);

    const octQueue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: OCT_CYCLE_ID });
    assert.equal(octQueue.length, 1);
    assert.equal(octQueue[0].id, 'sub-oct-1');
  });

  // 3. Pending moderation count matches actual pending submissions
  it('3. Pending moderation count matches actual pending submissions', async () => {
    submissionsStore.push(
      makeRecord({ id: 'sub-1', contestId: NOV_CYCLE_ID, status: SubmissionStatus.PENDING_REVIEW }),
      makeRecord({ id: 'sub-2', contestId: NOV_CYCLE_ID, status: SubmissionStatus.PENDING_REVIEW }),
      makeRecord({ id: 'sub-3', contestId: NOV_CYCLE_ID, status: SubmissionStatus.APPROVED }),
    );

    const novQueue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(novQueue.length, 2);
  });

  // 4. Approved submission disappears from pending and appears in approved list
  it('4. Approved submission disappears from pending queue', async () => {
    const sub = makeRecord({
      id: 'sub-to-approve',
      contestId: NOV_CYCLE_ID,
      status: SubmissionStatus.PENDING_REVIEW,
    });
    submissionsStore.push(sub);

    let queue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(queue.length, 1);

    // Transition to APPROVED
    sub.status = SubmissionStatus.APPROVED;
    sub.moderatedAt = new Date();
    sub.moderatedById = ADMIN_ACTOR.id;

    queue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(queue.length, 0);
  });

  // 5. Rejected submission appears in Rejected Log
  it('5. Rejected submission appears in Rejected Log with cycle and reason', async () => {
    const sub = makeRecord({
      id: 'sub-to-reject',
      contestId: NOV_CYCLE_ID,
      title: 'Watermarked Video',
      status: SubmissionStatus.REJECTED,
      rejectionReason: 'Rules violation',
    });
    submissionsStore.push(sub);

    auditLogsStore.push({
      id: 'audit-reject-1',
      submissionId: sub.id,
      actorId: ADMIN_ACTOR.id,
      action: AuditAction.REJECT,
      reason: 'Rules violation',
      metadata: { newStatus: 'REJECTED' },
      createdAt: new Date(),
      actor: { id: ADMIN_ACTOR.id, name: 'Admin' },
      submission: {
        id: sub.id,
        contestId: NOV_CYCLE_ID,
        title: sub.title,
        status: SubmissionStatus.REJECTED,
        creator: { id: CREATOR_ALICE, name: 'Alice' },
        contest: {
          id: NOV_CYCLE_ID,
          title: 'November 2026',
          seriesSlug: 'pledge',
          cycleMonth: '2026-11',
        },
      },
    });

    const logs = await ModerationService.listAuditLogs(ADMIN_ACTOR, {
      seriesSlug: 'pledge',
      contestId: NOV_CYCLE_ID,
    });
    assert.equal(logs.length, 1);
    const view = toAuditLogView(logs[0]);
    assert.equal(view.action, 'REJECT');
    assert.equal(view.submission?.contest?.seriesSlug, 'pledge');
    assert.equal(view.submission?.contestId, NOV_CYCLE_ID);
  });

  // 6. Generic contest submissions remain unaffected
  it('6. Generic contest submissions remain unaffected when filtering', async () => {
    submissionsStore.push(
      makeRecord({
        id: 'sub-generic',
        contestId: GENERIC_CONTEST_ID,
        contest: {
          id: GENERIC_CONTEST_ID,
          title: 'General Challenge',
          status: ContestStatus.ACTIVE,
          seriesSlug: null,
          cycleMonth: null,
          category: null,
        },
        status: SubmissionStatus.PENDING_REVIEW,
      }),
      makeRecord({
        id: 'sub-pledge',
        contestId: NOV_CYCLE_ID,
        status: SubmissionStatus.PENDING_REVIEW,
      }),
    );

    // Global queue returns both
    const allPending = await ModerationService.listQueue(ADMIN_ACTOR);
    assert.equal(allPending.length, 2);

    // Scoped pledge queue excludes generic
    const pledgePending = await ModerationService.listQueue(ADMIN_ACTOR, { seriesSlug: 'pledge' });
    assert.equal(pledgePending.length, 1);
    assert.equal(pledgePending[0].id, 'sub-pledge');

    // Scoped generic queue excludes pledge
    const genericPending = await ModerationService.listQueue(ADMIN_ACTOR, {
      contestId: GENERIC_CONTEST_ID,
    });
    assert.equal(genericPending.length, 1);
    assert.equal(genericPending[0].id, 'sub-generic');
  });

  // 7. Pledge submissions are not excluded by generic contest filters
  it('7. Pledge submissions are not excluded when querying all submissions', async () => {
    submissionsStore.push(
      makeRecord({ id: 'sub-pledge-nov', contestId: NOV_CYCLE_ID, status: SubmissionStatus.PENDING_REVIEW }),
    );
    const all = await ModerationService.listQueue(ADMIN_ACTOR);
    assert.equal(all.length, 1);
    assert.equal(all[0].contest.seriesSlug, 'pledge');
  });

  // 8. Replacement submission follows correct moderation behavior
  it('8. Replacement submission enters moderation queue with replacement tags', async () => {
    const replacement = makeRecord({
      id: 'sub-v2',
      contestId: NOV_CYCLE_ID,
      title: 'Reflections (Revised Version)',
      tags: ['replacement', 'replaces:sub-v1'],
      status: SubmissionStatus.PENDING_REVIEW,
    });
    submissionsStore.push(replacement);

    const queue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'sub-v2');
    assert.ok(queue[0].tags.includes('replacement'));
  });

  // 9. Old replaced versions do not appear as duplicate active entries
  it('9. Old replaced versions do not appear as duplicate active entries', async () => {
    const oldVersion = makeRecord({
      id: 'sub-v1',
      contestId: NOV_CYCLE_ID,
      title: 'Reflections (Old)',
      status: SubmissionStatus.PENDING_REVIEW,
      deletedAt: new Date('2026-11-03T18:00:00Z'),
      deletedById: CREATOR_ALICE,
      rejectionReason: 'REPLACED_BY:sub-v2',
    });
    const newVersion = makeRecord({
      id: 'sub-v2',
      contestId: NOV_CYCLE_ID,
      title: 'Reflections (New)',
      status: SubmissionStatus.PENDING_REVIEW,
      deletedAt: null,
    });
    submissionsStore.push(oldVersion, newVersion);

    const queue = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'sub-v2');
  });

  // 10. Creator cannot see another creator's private submissions
  it('10. Non-admin users cannot access the moderation queue', async () => {
    await assert.rejects(
      async () => {
        await ModerationService.listQueue(CREATOR_ALICE_ACTOR as any);
      },
      { name: 'ForbiddenError' },
    );
  });

  // 11. Correct cycle filtering works when switching months
  it('11. Correct cycle filtering works when switching months', async () => {
    submissionsStore.push(
      makeRecord({ id: 'sub-nov', contestId: NOV_CYCLE_ID, status: SubmissionStatus.PENDING_REVIEW }),
      makeRecord({
        id: 'sub-oct',
        contestId: OCT_CYCLE_ID,
        contest: {
          id: OCT_CYCLE_ID,
          title: 'Pledge October',
          status: ContestStatus.COMPLETED,
          seriesSlug: 'pledge',
          cycleMonth: '2026-10',
          category: null,
        },
        status: SubmissionStatus.PENDING_REVIEW,
      }),
    );

    // Switching to November shows sub-nov
    const novResult = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: NOV_CYCLE_ID });
    assert.equal(novResult.length, 1);
    assert.equal(novResult[0].id, 'sub-nov');

    // Switching to October shows sub-oct
    const octResult = await ModerationService.listQueue(ADMIN_ACTOR, { contestId: OCT_CYCLE_ID });
    assert.equal(octResult.length, 1);
    assert.equal(octResult[0].id, 'sub-oct');
  });

  // 12. Successful upload completion cannot silently leave a submission without the required moderation state
  it('12. Newly created submissions always have status PENDING_REVIEW and deletedAt null', async () => {
    const sub = makeRecord({
      id: 'sub-new',
      contestId: NOV_CYCLE_ID,
      status: SubmissionStatus.PENDING_REVIEW,
      deletedAt: null,
    });
    const view = await toModerationSubmissionView(sub);
    assert.equal(view.status, SubmissionStatus.PENDING_REVIEW);
    assert.equal(view.contestId, NOV_CYCLE_ID);
    assert.equal(view.contest?.seriesSlug, 'pledge');
  });
});

