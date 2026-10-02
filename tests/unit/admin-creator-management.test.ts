import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountStatus, AuditAction, ContestStatus, Role, SubmissionStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { AdminCreatorRepository } from '../../src/repositories/admin-creator.repository.js';
import { AuditLogRepository } from '../../src/repositories/audit-log.repository.js';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import { CreatorActivityRepository } from '../../src/repositories/creator-activity.repository.js';
import { CreatorWarningRepository } from '../../src/repositories/creator-warning.repository.js';
import { SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AdminCreatorService } from '../../src/services/admin-creator.service.js';
import { AuthService } from '../../src/services/auth.service.js';
import { CreatorActivityService } from '../../src/services/creator-activity.service.js';
import { setModerationTransactionRunner } from '../../src/services/moderation.service.js';
import { ModerationService } from '../../src/services/moderation.service.js';
import { SubmissionService } from '../../src/services/submission.service.js';
import { setStorageService } from '../../src/services/storage.service.js';
import { ForbiddenError } from '../../src/utils/response.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CREATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-0000000000aa';
const CONTEST = '11111111-1111-4111-8111-111111111111';
const CONTEST_B = '11111111-1111-4111-8111-111111111112';
const VIDEO = '22222222-2222-4222-8222-222222222221';
const VIDEO_B = '22222222-2222-4222-8222-222222222222';

const creatorRow = {
  id: CREATOR,
  email: 'ada@example.com',
  name: 'Ada',
  role: Role.CREATOR,
  accountStatus: AccountStatus.ACTIVE,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

describe('admin creator management', { concurrency: false }, () => {
  let app: FastifyInstance;
  const originals = {
    summary: AdminCreatorRepository.summary,
    searchCreators: AdminCreatorRepository.searchCreators,
    submissionStatsForCreators: AdminCreatorRepository.submissionStatsForCreators,
    creatorStats: AdminCreatorRepository.creatorStats,
    countContestParticipants: AdminCreatorRepository.countContestParticipants,
    pageContestParticipants: AdminCreatorRepository.pageContestParticipants,
    findCreatorById: UserRepository.findCreatorById,
    findAccountGate: UserRepository.findAccountGate,
    updateAccountStatus: UserRepository.updateAccountStatus,
    findByEmail: UserRepository.findByEmail,
    createCreator: UserRepository.createCreator,
    findById: SubmissionRepository.findById,
    deleteById: SubmissionRepository.deleteById,
    listParticipation: SubmissionRepository.listCreatorParticipation,
    pageByCreator: SubmissionRepository.pageByCreator,
    createSubmission: SubmissionRepository.create,
    findByObjectKey: SubmissionRepository.findByObjectKey,
    applyDecision: SubmissionRepository.applyDecision,
    findContest: ContestRepository.findById,
    createWarning: CreatorWarningRepository.create,
    listWarnings: CreatorWarningRepository.listByCreator,
    createActivity: CreatorActivityRepository.create,
    latestForCreators: CreatorActivityRepository.latestForCreators,
    findLatest: CreatorActivityRepository.findLatest,
    pageActivity: CreatorActivityRepository.pageByCreator,
    createAudit: AuditLogRepository.create,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    setStorageService({
      async createPresignedUpload() {
        throw new Error('unused');
      },
      getPublicUrl(objectKey: string) {
        return `https://example.com/${objectKey}`;
      },
    });
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    setStorageService(null);
    setModerationTransactionRunner(null);
    AdminCreatorRepository.summary = originals.summary;
    AdminCreatorRepository.searchCreators = originals.searchCreators;
    AdminCreatorRepository.submissionStatsForCreators = originals.submissionStatsForCreators;
    AdminCreatorRepository.creatorStats = originals.creatorStats;
    AdminCreatorRepository.countContestParticipants = originals.countContestParticipants;
    AdminCreatorRepository.pageContestParticipants = originals.pageContestParticipants;
    UserRepository.findCreatorById = originals.findCreatorById;
    UserRepository.findAccountGate = originals.findAccountGate;
    UserRepository.updateAccountStatus = originals.updateAccountStatus;
    UserRepository.findByEmail = originals.findByEmail;
    UserRepository.createCreator = originals.createCreator;
    SubmissionRepository.findById = originals.findById;
    SubmissionRepository.deleteById = originals.deleteById;
    SubmissionRepository.listCreatorParticipation = originals.listParticipation;
    SubmissionRepository.pageByCreator = originals.pageByCreator;
    SubmissionRepository.create = originals.createSubmission;
    SubmissionRepository.findByObjectKey = originals.findByObjectKey;
    SubmissionRepository.applyDecision = originals.applyDecision;
    ContestRepository.findById = originals.findContest;
    CreatorWarningRepository.create = originals.createWarning;
    CreatorWarningRepository.listByCreator = originals.listWarnings;
    CreatorActivityRepository.create = originals.createActivity;
    CreatorActivityRepository.latestForCreators = originals.latestForCreators;
    CreatorActivityRepository.findLatest = originals.findLatest;
    CreatorActivityRepository.pageByCreator = originals.pageActivity;
    AuditLogRepository.create = originals.createAudit;
    await app.close();
  });

  function token(role: Role) {
    return app.jwt.sign({ id: role === Role.ADMIN ? ADMIN : CREATOR, email: 'a@b.c', role });
  }

  it('keeps ratings and comments cascading with the submission, not the creator', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const rating = schema.slice(schema.indexOf('model Rating'), schema.indexOf('model Comment'));
    const comment = schema.slice(schema.indexOf('model Comment'), schema.indexOf('model CreatorWarning'));
    assert.match(rating, /onDelete: Cascade/);
    assert.match(comment, /onDelete: Cascade/);
    const service = readFileSync(join(ROOT, 'src/services/admin-creator.service.ts'), 'utf8');
    const block = service.slice(service.indexOf('static async deleteSubmission'));
    assert.match(block, /deleteById/);
    assert.match(block, /mediaObjectRetained: true/);
    assert.doesNotMatch(block, /user\.delete|UserRepository\.delete/);
  });

  it('lets an admin list creators and rejects creator and guest', async () => {
    AdminCreatorRepository.summary = async () => ({
      totalCreators: 1,
      activeCreators: 1,
      blockedCreators: 0,
      totalVideos: 3,
      approvedVideos: 1,
      pendingVideos: 1,
      rejectedVideos: 1,
      flaggedVideos: 0,
      underModerationVideos: 1,
    });
    AdminCreatorRepository.searchCreators = async () => ({
      totalCount: 1,
      users: [creatorRow],
    });
    AdminCreatorRepository.submissionStatsForCreators = async () => ({
      byStatus: [
        { creatorId: CREATOR, status: SubmissionStatus.APPROVED, _count: { _all: 1 } },
        { creatorId: CREATOR, status: SubmissionStatus.PENDING_REVIEW, _count: { _all: 1 } },
        { creatorId: CREATOR, status: SubmissionStatus.REJECTED, _count: { _all: 1 } },
      ],
      byContest: [
        { creatorId: CREATOR, contestId: CONTEST },
        { creatorId: CREATOR, contestId: CONTEST_B },
      ],
      ratings: [],
    });
    CreatorActivityRepository.latestForCreators = async () => [
      { creatorId: CREATOR, _max: { createdAt: new Date('2026-10-02T00:00:00.000Z') } },
    ];

    const guest = await app.inject({ method: 'GET', url: '/api/v1/admin/creators' });
    assert.equal(guest.statusCode, 401);

    const creator = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/creators',
      headers: { authorization: `Bearer ${token(Role.CREATOR)}` },
    });
    assert.equal(creator.statusCode, 403);

    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/creators?search=ada&status=ACTIVE',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    assert.equal(admin.statusCode, 200);
    const body = JSON.parse(admin.payload);
    assert.equal(body.data.summary.totalCreators, 1);
    assert.equal(body.data.creators[0].email, 'ada@example.com');
    assert.equal(body.data.creators[0].totalVideos, 3);
    assert.equal(body.data.creators[0].contestsParticipated, 2);
    assert.equal(body.data.pagination.currentPage, 1);
  });

  it('returns contest participation and paginated submissions for one creator', async () => {
    UserRepository.findCreatorById = async () => creatorRow;
    SubmissionRepository.listCreatorParticipation = async () =>
      [
        {
          id: VIDEO,
          title: 'Bit',
          status: SubmissionStatus.APPROVED,
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
          updatedAt: new Date('2026-10-02T01:00:00.000Z'),
          contestId: CONTEST,
          communityScore: 4,
          totalVotes: 2,
          contest: { id: CONTEST, title: 'Open Mic', status: ContestStatus.ACTIVE },
        },
        {
          id: VIDEO_B,
          title: 'Second',
          status: SubmissionStatus.PENDING_REVIEW,
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          updatedAt: new Date('2026-10-03T00:00:00.000Z'),
          contestId: CONTEST_B,
          communityScore: 0,
          totalVotes: 0,
          contest: { id: CONTEST_B, title: 'Late Show', status: ContestStatus.JUDGING },
        },
      ] as never;
    SubmissionRepository.pageByCreator = async () =>
      ({
        totalCount: 1,
        rows: [
          {
            id: VIDEO,
            title: 'Bit',
            status: SubmissionStatus.APPROVED,
            createdAt: new Date('2026-10-02T00:00:00.000Z'),
            updatedAt: new Date('2026-10-02T01:00:00.000Z'),
            contestId: CONTEST,
            communityScore: 4.2,
            totalVotes: 183,
            durationSeconds: 12,
            objectKey: 'not-a-storage-key',
            videoUrl: 'https://example.com/video.mp4',
            contest: { title: 'Open Mic', status: ContestStatus.ACTIVE },
          },
        ],
      }) as never;

    const contests = await AdminCreatorService.listContests(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
    );
    assert.equal(contests.contests.length, 2);
    assert.equal(contests.contests[0].title, 'Late Show');
    assert.equal(contests.contests[1].submissions[0].title, 'Bit');

    const submissions = await AdminCreatorService.listSubmissions(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
      { page: 1, limit: 20 },
    );
    assert.equal(submissions.items[0].id, VIDEO);
    assert.equal(submissions.items[0].contestTitle, 'Open Mic');
    assert.equal(submissions.items[0].videoUrl, 'https://example.com/video.mp4');
    assert.equal(submissions.pagination.totalCount, 1);

    await assert.rejects(
      () => AdminCreatorService.listContests({ id: CREATOR, role: Role.CREATOR }, CREATOR),
      /Forbidden/,
    );
  });

  it('persists a warning and a block, then lets an admin unblock', async () => {
    const warnings: Array<{ creatorId: string; issuedById: string; reason: string }> = [];
    const activities: string[] = [];
    UserRepository.findCreatorById = async () => ({ ...creatorRow });
    CreatorWarningRepository.create = async (data) => {
      warnings.push(data);
      return {
        id: 'warning-1',
        creatorId: data.creatorId,
        issuedById: data.issuedById,
        reason: data.reason,
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        issuedBy: { id: ADMIN, name: 'Admin', email: 'admin@example.com' },
      };
    };
    CreatorActivityRepository.create = async (data) => {
      activities.push(data.action);
      return data as never;
    };
    let status = AccountStatus.ACTIVE;
    UserRepository.updateAccountStatus = async (_id, next) => {
      status = next;
      return { ...creatorRow, accountStatus: next };
    };

    const warning = await AdminCreatorService.warn(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
      '  Please review the rules  ',
    );
    assert.equal(warnings[0].reason, 'Please review the rules');
    assert.equal(warnings[0].issuedById, ADMIN);
    assert.equal(warning.reason, 'Please review the rules');
    assert.equal(activities.includes('WARNED'), true);

    const blocked = await AdminCreatorService.setStatus(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
      AccountStatus.BLOCKED,
    );
    assert.equal(blocked.accountStatus, AccountStatus.BLOCKED);
    assert.equal(status, AccountStatus.BLOCKED);
    UserRepository.findCreatorById = async () => ({
      ...creatorRow,
      accountStatus: AccountStatus.BLOCKED,
    });
    const unblocked = await AdminCreatorService.setStatus(
      { id: ADMIN, role: Role.ADMIN },
      CREATOR,
      AccountStatus.ACTIVE,
    );
    assert.equal(unblocked.accountStatus, AccountStatus.ACTIVE);
    assert.deepEqual(activities, ['WARNED', 'BLOCKED', 'UNBLOCKED']);

    UserRepository.findCreatorById = async () => null;
    await assert.rejects(
      () =>
        AdminCreatorService.setStatus(
          { id: ADMIN, role: Role.ADMIN },
          ADMIN,
          AccountStatus.BLOCKED,
        ),
      /Creator not found/,
    );
  });

  it('rejects creator actions when the account is blocked', async () => {
    UserRepository.findAccountGate = async () => ({
      id: CREATOR,
      role: Role.CREATOR,
      accountStatus: AccountStatus.BLOCKED,
    });
    await assert.rejects(
      () =>
        SubmissionService.presign(
          { id: CREATOR, role: Role.CREATOR },
          {
            contestId: CONTEST,
            contentType: 'video/mp4',
            fileSizeBytes: 1000,
            durationSeconds: 10,
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenError);
        assert.equal(error.statusCode, 403);
        return true;
      },
    );

    const http = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: { authorization: `Bearer ${token(Role.CREATOR)}` },
      payload: {
        contestId: CONTEST,
        contentType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
      },
    });
    assert.equal(http.statusCode, 403);
    assert.match(JSON.parse(http.payload).message, /blocked/);
  });

  it('lets only an admin delete a submission and records the activity', async () => {
    const activities: Array<Record<string, unknown>> = [];
    let deleted: string | null = null;
    SubmissionRepository.findById = async (id) =>
      id === VIDEO
        ? ({
            id,
            creatorId: CREATOR,
            contestId: CONTEST,
            title: 'Bit',
            contest: { title: 'Open Mic' },
          } as never)
        : null;
    SubmissionRepository.deleteById = async (id) => {
      deleted = id;
    };
    CreatorActivityRepository.create = async (data) => {
      activities.push(data as unknown as Record<string, unknown>);
      return data as never;
    };

    const guest = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/submissions/${VIDEO}`,
    });
    assert.equal(guest.statusCode, 401);

    const creator = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/submissions/${VIDEO}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR)}` },
    });
    assert.equal(creator.statusCode, 403);
    assert.equal(deleted, null);

    const result = await AdminCreatorService.deleteSubmission(
      { id: ADMIN, role: Role.ADMIN },
      VIDEO,
    );
    assert.equal(result.deleted, true);
    assert.equal(result.mediaObjectRetained, true);
    assert.equal(deleted, VIDEO);
    assert.equal(activities[0].action, 'SUBMISSION_DELETED');
    assert.equal(activities[0].performedByUserId, ADMIN);
    assert.equal(activities[0].creatorId, CREATOR);
  });

  it('writes creator activity without passwords or tokens', async () => {
    let saved: { description?: string | null; metadata?: unknown; action?: string } | null = null;
    CreatorActivityRepository.create = async (data) => {
      saved = data;
      return data as never;
    };
    await CreatorActivityService.record({
      creatorId: CREATOR,
      action: 'REGISTERED',
      metadata: { password: 'password123', token: 'jwt', submissionTitle: 'Bit' },
    });
    assert.equal(saved?.action, 'REGISTERED');
    const metadata = saved?.metadata as Record<string, unknown>;
    assert.equal(metadata.submissionTitle, 'Bit');
    assert.equal('password' in metadata, false);
    assert.equal('token' in metadata, false);
    assert.equal(JSON.stringify(saved).includes('password123'), false);

    UserRepository.findByEmail = async () => null;
    UserRepository.createCreator = async () => creatorRow;
    await AuthService.registerCreator(
      { email: 'ada@example.com', password: 'password123', name: 'Ada' },
      app,
    );
    assert.equal(saved?.action, 'REGISTERED');
    assert.equal(JSON.stringify(saved).includes('password123'), false);
  });

  it('logs a completed upload and a moderation decision', async () => {
    const activities: string[] = [];
    UserRepository.findAccountGate = async () => ({
      id: CREATOR,
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
    });
    ContestRepository.findById = async () =>
      ({
        id: CONTEST,
        status: ContestStatus.ACTIVE,
        title: 'Open Mic',
      }) as never;
    SubmissionRepository.findByObjectKey = async () => null;
    SubmissionRepository.create = async (data) =>
      ({
        ...data,
        id: VIDEO,
        status: SubmissionStatus.PENDING_REVIEW,
        contest: { title: 'Open Mic', status: ContestStatus.ACTIVE },
      }) as never;
    CreatorActivityRepository.create = async (data) => {
      activities.push(data.action);
      return data as never;
    };

    const uploaded = await SubmissionService.complete(
      { id: CREATOR, role: Role.CREATOR },
      {
        contestId: CONTEST,
        objectKey: `contests/${CONTEST}/creators/${CREATOR}/${VIDEO}.mp4`,
        title: 'Bit',
        durationSeconds: 12,
      },
    );
    assert.equal(uploaded.created, true);
    assert.equal(activities[0], 'SUBMISSION_UPLOADED');

    SubmissionRepository.findById = async () =>
      ({
        id: VIDEO,
        creatorId: CREATOR,
        contestId: CONTEST,
        title: 'Bit',
        status: SubmissionStatus.PENDING_REVIEW,
        contest: { id: CONTEST, title: 'Open Mic', status: ContestStatus.ACTIVE },
      }) as never;
    SubmissionRepository.applyDecision = async () =>
      ({
        id: VIDEO,
        creatorId: CREATOR,
        contestId: CONTEST,
        title: 'Bit',
        status: SubmissionStatus.APPROVED,
        contest: { title: 'Open Mic' },
      }) as never;
    AuditLogRepository.create = async (data) =>
      ({
        id: 'audit-1',
        ...data,
        createdAt: new Date(),
      }) as never;
    setModerationTransactionRunner(async (fn) => fn({} as never));
    await ModerationService.approve({ id: ADMIN, role: Role.ADMIN }, VIDEO);
    assert.equal(activities[1], 'SUBMISSION_APPROVED');
  });
});
