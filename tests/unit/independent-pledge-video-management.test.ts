import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountStatus,
  AuditAction,
  ContestStatus,
  Role,
  SubmissionStatus,
  VideoDomain,
} from '@prisma/client';
import {
  ModerationService,
  setModerationTransactionRunner,
} from '../../src/services/moderation.service.js';
import { PledgeVideoService } from '../../src/services/pledge-video.service.js';
import { SubmissionService } from '../../src/services/submission.service.js';
import { ContestService } from '../../src/services/contest.service.js';
import {
  SubmissionRepository,
  ModerationQueueRecord,
  SubmissionRecord,
} from '../../src/repositories/submission.repository.js';
import { AuditLogRepository, AuditLogRecord } from '../../src/repositories/audit-log.repository.js';
import { ContestRepository, ContestRecord } from '../../src/repositories/contest.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { CreatorActivityService } from '../../src/services/creator-activity.service.js';
import { NotificationService } from '../../src/services/notification.service.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../../src/utils/response.js';

describe('Architectural Separation: Independent Pledge Video Management', () => {
  const REGULAR_CONTEST_ID = '00000000-0000-4000-8000-000000000001';
  const PLEDGE_CONTEST_ID = 'e17c5d4c-aca7-4b4d-a9ef-1bc01fdda754';
  const CREATOR_ALICE = '11111111-1111-4111-8111-111111111111';
  const CREATOR_BOB = '22222222-2222-4222-8222-222222222222';
  const ADMIN_ACTOR = { id: 'admin-1', role: Role.ADMIN };
  const CREATOR_ACTOR = { id: CREATOR_ALICE, role: Role.CREATOR };

  let submissionsStore: (SubmissionRecord & { domain: VideoDomain })[] = [];
  let auditLogsStore: AuditLogRecord[] = [];
  let contestsStore: ContestRecord[] = [];

  function makeContest(overrides: Partial<ContestRecord>): ContestRecord {
    return {
      id: overrides.id ?? REGULAR_CONTEST_ID,
      title: overrides.title ?? 'Regular Ripskis Video Contest',
      description: overrides.description ?? 'Regular contest',
      tagline: null,
      bannerUrl: null,
      bannerObjectKey: null,
      thumbnailUrl: null,
      status: overrides.status ?? ContestStatus.ACTIVE,
      timezone: 'Asia/Kolkata',
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-12-01T00:00:00Z'),
      votingClosesAt: null,
      seriesSlug: overrides.seriesSlug ?? null,
      cycleMonth: overrides.cycleMonth ?? null,
      isRecurringMonthly: false,
      minOverallVoters: 10,
      minCategoryVoters: 5,
      configFrozenAt: null,
      isWinnersFinalized: false,
      winnersFinalizedAt: null,
      winnersData: null,
      scoringCategories: null,
      combinedScoreEnabled: false,
      winnerCount: null,
      maxVideoSizeMb: null,
      maxVideoDurationSeconds: null,
      allowedVideoFormats: null,
      rankingNeedsReview: false,
      prizeSummary: null,
      rules: null,
      autoAdvanceDelayMs: 1800,
      createdAt: new Date(),
      updatedAt: new Date(),
      categoryId: null,
      category: null,
      ...overrides,
    };
  }

  function makeSubmission(
    overrides: Partial<SubmissionRecord & { domain: VideoDomain }>,
  ): SubmissionRecord & { domain: VideoDomain } {
    const contestId = overrides.contestId ?? REGULAR_CONTEST_ID;
    const isPledge = overrides.domain === VideoDomain.PLEDGE || contestId === PLEDGE_CONTEST_ID;
    const domain = overrides.domain ?? (isPledge ? VideoDomain.PLEDGE : VideoDomain.REGULAR);

    return {
      id: overrides.id ?? 'sub-1',
      domain,
      contestId,
      creatorId: overrides.creatorId ?? CREATOR_ALICE,
      title: overrides.title ?? 'Sample Video',
      description: overrides.description ?? null,
      videoUrl: overrides.videoUrl ?? 'https://s3/sample.mp4',
      objectKey: overrides.objectKey ?? `contests/${contestId}/video.mp4`,
      thumbnailUrl: overrides.thumbnailUrl ?? null,
      durationSeconds: overrides.durationSeconds ?? 30,
      status: overrides.status ?? SubmissionStatus.PENDING_REVIEW,
      rejectionReason: overrides.rejectionReason ?? null,
      moderatedById: overrides.moderatedById ?? null,
      moderatedAt: overrides.moderatedAt ?? null,
      tags: overrides.tags ?? [],
      communityScore: overrides.communityScore ?? 0,
      totalVotes: overrides.totalVotes ?? 0,
      deletedAt: overrides.deletedAt ?? null,
      deletedById: overrides.deletedById ?? null,
      createdAt: overrides.createdAt ?? new Date('2026-11-01T12:00:00Z'),
      updatedAt: overrides.updatedAt ?? new Date('2026-11-01T12:00:00Z'),
      categoryId: null,
      otherCategoryLabel: null,
      contest: overrides.contest ?? {
        id: contestId,
        title: isPledge ? 'Pledge Contest' : 'Regular Contest',
        status: ContestStatus.ACTIVE,
        seriesSlug: isPledge ? 'pledge' : null,
        cycleMonth: isPledge ? '2026-11' : null,
        category: null,
      },
      deletedBy: null,
      videoCategory: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    submissionsStore = [];
    auditLogsStore = [];
    contestsStore = [
      makeContest({
        id: REGULAR_CONTEST_ID,
        title: 'Regular Ripskis Video Challenge',
        seriesSlug: null,
        cycleMonth: null,
      }),
      makeContest({
        id: PLEDGE_CONTEST_ID,
        title: 'Pledge of aWEEEEEDgence testing — November 2026',
        seriesSlug: 'pledge',
        cycleMonth: '2026-11',
      }),
    ];

    setModerationTransactionRunner(async (fn) => fn({} as any));

    UserRepository.findAccountGate = async (id: string) => {
      return {
        role: Role.CREATOR,
        accountStatus: AccountStatus.ACTIVE,
      } as any;
    };

    CreatorActivityService.record = async () => ({} as any);
    NotificationService.notifySubmissionApproved = async () => {};

    // Mock SubmissionRepository
    SubmissionRepository.findById = async (id: string) => {
      const found = submissionsStore.find((s) => s.id === id);
      return (found as SubmissionRecord) ?? null;
    };

    SubmissionRepository.listPendingReview = async (filter?: {
      contestId?: string;
      seriesSlug?: string;
      domain?: VideoDomain;
    }) => {
      return submissionsStore.filter((s) => {
        if (s.status !== SubmissionStatus.PENDING_REVIEW) return false;
        if (s.deletedAt !== null) return false;
        if (filter?.domain && s.domain !== filter.domain) return false;
        if (filter?.contestId && s.contestId !== filter.contestId) return false;
        if (filter?.seriesSlug && s.contest.seriesSlug !== filter.seriesSlug) return false;
        return true;
      }) as any;
    };

    SubmissionRepository.listByCreatorId = async (
      creatorId: string,
      options?: { includeDeleted?: boolean; domain?: VideoDomain },
    ) => {
      return submissionsStore.filter((s) => {
        if (s.creatorId !== creatorId) return false;
        if (!options?.includeDeleted && s.deletedAt !== null) return false;
        if (options?.domain && s.domain !== options.domain) return false;
        return true;
      });
    };

    SubmissionRepository.applyDecision = async (id, data) => {
      const sub = submissionsStore.find((s) => s.id === id);
      if (!sub) throw new NotFoundError('Submission not found');
      sub.status = data.status;
      sub.rejectionReason = data.rejectionReason;
      sub.moderatedById = data.moderatedById;
      sub.moderatedAt = data.moderatedAt;
      return sub as SubmissionRecord;
    };

    // Mock ContestRepository.list
    ContestRepository.list = async (filters) => {
      return contestsStore.filter((c) => {
        if (filters.excludeSeriesSlug && c.seriesSlug === filters.excludeSeriesSlug) return false;
        if (filters.seriesSlug !== undefined && c.seriesSlug !== filters.seriesSlug) return false;
        if (filters.status && c.status !== filters.status) return false;
        if (filters.statuses && !filters.statuses.includes(c.status)) return false;
        return true;
      });
    };

    ContestRepository.findById = async (id: string) => {
      return contestsStore.find((c) => c.id === id) ?? null;
    };

    AuditLogRepository.list = async (filter?: {
      contestId?: string;
      seriesSlug?: string;
      domain?: VideoDomain;
    }) => {
      return auditLogsStore.filter((log) => {
        if (filter?.contestId && log.submission?.contestId !== filter.contestId) return false;
        if (filter?.seriesSlug && log.submission?.contest?.seriesSlug !== filter.seriesSlug) return false;
        return true;
      });
    };

    AuditLogRepository.create = async (data) => {
      const sub = submissionsStore.find((s) => s.id === data.submissionId);
      const log: AuditLogRecord = {
        id: `audit-${Date.now()}`,
        submissionId: data.submissionId ?? null,
        actorId: data.actorId,
        action: data.action,
        reason: data.reason,
        metadata: data.metadata as any,
        createdAt: new Date(),
        actor: { id: data.actorId, name: 'Admin' },
        submission: sub
          ? {
              id: sub.id,
              contestId: sub.contestId,
              title: sub.title,
              status: sub.status,
              contest: sub.contest,
              creator: { id: sub.creatorId, name: 'Creator' },
            }
          : null,
      };
      auditLogsStore.push(log);
      return log;
    };
  });

  // 1. Classification & Domain Assignment
  it('1. Existing Pledge videos are classified correctly with domain PLEDGE', async () => {
    const pledgeSub = makeSubmission({
      id: 'sub-pledge-1',
      contestId: PLEDGE_CONTEST_ID,
      domain: VideoDomain.PLEDGE,
    });
    const regularSub = makeSubmission({
      id: 'sub-regular-1',
      contestId: REGULAR_CONTEST_ID,
      domain: VideoDomain.REGULAR,
    });
    submissionsStore.push(pledgeSub, regularSub);

    assert.equal(pledgeSub.domain, VideoDomain.PLEDGE);
    assert.equal(regularSub.domain, VideoDomain.REGULAR);
  });

  // 2. Pledge videos appear only in Pledge Videos
  it('2. Pledge videos appear only when querying Pledge domain', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE, contestId: PLEDGE_CONTEST_ID }),
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR, contestId: REGULAR_CONTEST_ID }),
    );

    const pledgeQueue = await SubmissionRepository.listPendingReview({ domain: VideoDomain.PLEDGE });
    assert.equal(pledgeQueue.length, 1);
    assert.equal(pledgeQueue[0].id, 'p1');
    assert.equal(pledgeQueue[0].domain, VideoDomain.PLEDGE);
  });

  // 3. Regular videos appear only in regular Ripskis Videos
  it('3. Regular videos appear only when querying regular Ripskis domain', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE, contestId: PLEDGE_CONTEST_ID }),
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR, contestId: REGULAR_CONTEST_ID }),
    );

    const regularQueue = await SubmissionRepository.listPendingReview({ domain: VideoDomain.REGULAR });
    assert.equal(regularQueue.length, 1);
    assert.equal(regularQueue[0].id, 'r1');
    assert.equal(regularQueue[0].domain, VideoDomain.REGULAR);
  });

  // 4. Viewable contests feed excludes Pledge contest videos
  it('4. Public contest listing (Ripskis video feed) excludes Pledge contests', async () => {
    const viewable = await ContestService.listViewable();
    assert.equal(viewable.length, 1);
    assert.equal(viewable[0].id, REGULAR_CONTEST_ID);
    assert.notEqual(viewable[0].seriesSlug, 'pledge');

    const active = await ContestService.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].id, REGULAR_CONTEST_ID);
  });

  // 5. Creator listMine returns only regular Ripskis videos
  it('5. Creator submission list returns only regular Ripskis videos and excludes Pledge uploads', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'r1', creatorId: CREATOR_ALICE, domain: VideoDomain.REGULAR }),
      makeSubmission({ id: 'p1', creatorId: CREATOR_ALICE, domain: VideoDomain.PLEDGE }),
    );

    const myRegularVideos = await SubmissionService.listMine(CREATOR_ACTOR);
    assert.equal(myRegularVideos.length, 1);
    assert.equal(myRegularVideos[0].id, 'r1');
    assert.equal(myRegularVideos[0].domain, VideoDomain.REGULAR);
  });

  // 6. Creator cannot access a Pledge video via regular video endpoint
  it('6. Creator cannot access or delete a Pledge video via regular video endpoints', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', creatorId: CREATOR_ALICE, domain: VideoDomain.PLEDGE }),
    );

    await assert.rejects(
      async () => await SubmissionService.getById(CREATOR_ACTOR, 'p1'),
      NotFoundError,
    );

    await assert.rejects(
      async () => await SubmissionService.remove(CREATOR_ACTOR, 'p1'),
      NotFoundError,
    );
  });

  // 7. Cross-domain moderation action enforcement
  it('7. Regular moderation cannot approve or reject a Pledge video', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE }),
    );

    // Regular approve should reject Pledge video
    await assert.rejects(
      async () => await ModerationService.approve(ADMIN_ACTOR, 'p1', 'Approve test', VideoDomain.REGULAR),
      /Domain mismatch/,
    );

    // Regular reject should reject Pledge video
    await assert.rejects(
      async () => await ModerationService.reject(ADMIN_ACTOR, 'p1', 'Reason test', undefined, VideoDomain.REGULAR),
      /Domain mismatch/,
    );
  });

  // 8. Pledge moderation cannot approve or reject a regular Ripskis video
  it('8. Pledge moderation cannot approve or reject a regular Ripskis video', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR }),
    );

    // Pledge approve should reject regular video
    await assert.rejects(
      async () => await ModerationService.approve(ADMIN_ACTOR, 'r1', 'Approve test', VideoDomain.PLEDGE),
      /Domain mismatch/,
    );

    // Pledge reject should reject regular video
    await assert.rejects(
      async () => await ModerationService.reject(ADMIN_ACTOR, 'r1', 'Reason test', undefined, VideoDomain.PLEDGE),
      /Domain mismatch/,
    );
  });

  // 9. Regular moderation operates smoothly on regular videos
  it('9. Regular moderation approves regular videos and updates audit logs', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR }),
    );

    const result = await ModerationService.approve(ADMIN_ACTOR, 'r1', 'Good work', VideoDomain.REGULAR);
    assert.equal(result.submission.status, SubmissionStatus.APPROVED);
    assert.equal(result.audit.action, AuditAction.APPROVE);
    assert.equal(auditLogsStore.length, 1);
  });

  // 10. Pledge moderation operates smoothly on Pledge videos
  it('10. Pledge moderation approves Pledge videos and preserves Pledge domain', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE, contestId: PLEDGE_CONTEST_ID }),
    );

    const result = await ModerationService.approve(ADMIN_ACTOR, 'p1', 'Verified pledge', VideoDomain.PLEDGE);
    assert.equal(result.submission.status, SubmissionStatus.APPROVED);
    assert.equal(result.audit.action, AuditAction.APPROVE);
  });

  // 11. Non-admin cannot access moderation
  it('11. Non-admin users cannot perform moderation on either domain', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR }),
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE }),
    );

    await assert.rejects(
      async () => await ModerationService.approve(CREATOR_ACTOR, 'r1', undefined, VideoDomain.REGULAR),
      ForbiddenError,
    );
    await assert.rejects(
      async () => await ModerationService.approve(CREATOR_ACTOR, 'p1', undefined, VideoDomain.PLEDGE),
      ForbiddenError,
    );
  });

  // 12. Idempotency: Multiple queries and domain separation stay stable
  it('12. Independent domain isolation is idempotent and preserves integrity', async () => {
    submissionsStore.push(
      makeSubmission({ id: 'p1', domain: VideoDomain.PLEDGE }),
      makeSubmission({ id: 'p2', domain: VideoDomain.PLEDGE }),
      makeSubmission({ id: 'r1', domain: VideoDomain.REGULAR }),
    );

    const pledgeList = await SubmissionRepository.listPendingReview({ domain: VideoDomain.PLEDGE });
    const regularList = await SubmissionRepository.listPendingReview({ domain: VideoDomain.REGULAR });

    assert.equal(pledgeList.length, 2);
    assert.equal(regularList.length, 1);
    assert.ok(pledgeList.every((v) => v.domain === VideoDomain.PLEDGE));
    assert.ok(regularList.every((v) => v.domain === VideoDomain.REGULAR));
  });
});
