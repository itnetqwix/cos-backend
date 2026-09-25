import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { AuditAction, ContestStatus, Prisma, Role, SubmissionStatus } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { AuditLogRecord, AuditLogRepository, CreateAuditLogData } from '../../src/repositories/audit-log.repository.js';
import {
  ModerationQueueRecord,
  SubmissionRecord,
  SubmissionRepository,
} from '../../src/repositories/submission.repository.js';
import { setModerationTransactionRunner } from '../../src/services/moderation.service.js';
import { ModerationService } from '../../src/services/moderation.service.js';
import { ConflictError } from '../../src/utils/response.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const ORG_A = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const ORG_B = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const ADMIN_A = 'cccccccc-cccc-4ccc-8ccc-0000000000aa';
const ADMIN_B = 'cccccccc-cccc-4ccc-8ccc-0000000000bb';
const SUPER_ID = 'cccccccc-cccc-4ccc-8ccc-0000000000cc';
const CREATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000aa';

interface Memory {
  submissions: Map<string, SubmissionRecord & { creator: { id: string; name: string } }>;
  audits: AuditLogRecord[];
  seq: number;
}

function createMemory(): Memory {
  return { submissions: new Map(), audits: [], seq: 1 };
}

function submissionRow(
  id: string,
  organizationId: string,
  status: SubmissionStatus,
  contestStatus: ContestStatus = ContestStatus.ACTIVE,
): SubmissionRecord & { creator: { id: string; name: string } } {
  const now = new Date('2026-10-04T00:00:00.000Z');
  return {
    id,
    contestId: `contest-${organizationId.slice(0, 8)}`,
    creatorId: CREATOR_ID,
    title: `Entry ${id.slice(-4)}`,
    description: 'A short sketch.',
    videoUrl: `https://cos-test-bucket.s3.us-east-1.amazonaws.com/${id}.mp4`,
    objectKey: `org/${organizationId}/contests/c/creators/${CREATOR_ID}/${id}.mp4`,
    thumbnailUrl: null,
    durationSeconds: 20,
    status,
    rejectionReason: null,
    moderatedById: null,
    moderatedAt: null,
    tags: ['sketch'],
    communityScore: 0,
    totalVotes: 0,
    createdAt: now,
    updatedAt: now,
    creator: { id: CREATOR_ID, name: 'Ada Creator' },
    contest: {
      id: `contest-${organizationId.slice(0, 8)}`,
      title: organizationId === ORG_A ? 'Ripskis Open' : 'Other Open',
      status: contestStatus,
      organizationId,
      category: { id: 'cat-1', name: 'Sketch', slug: 'sketch' },
    },
  };
}

describe('M07 moderation APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let memory: Memory;

  const original = {
    findById: SubmissionRepository.findById,
    listPendingReview: SubmissionRepository.listPendingReview,
    applyDecision: SubmissionRepository.applyDecision,
    auditCreate: AuditLogRepository.create,
    auditList: AuditLogRepository.list,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    memory = createMemory();

    setModerationTransactionRunner(async (fn) => fn({} as Prisma.TransactionClient));

    SubmissionRepository.findById = (async (id: string) =>
      memory.submissions.get(id) ?? null) as typeof SubmissionRepository.findById;

    SubmissionRepository.listPendingReview = (async (organizationId?: string) => {
      const rows = [...memory.submissions.values()].filter((row) => {
        if (row.status !== SubmissionStatus.PENDING_REVIEW) return false;
        if (organizationId && row.contest.organizationId !== organizationId) return false;
        return true;
      });
      return rows as ModerationQueueRecord[];
    }) as typeof SubmissionRepository.listPendingReview;

    SubmissionRepository.applyDecision = (async (id, data) => {
      const current = memory.submissions.get(id);
      if (!current) {
        throw new ConflictError('Submission not found');
      }
      if (
        current.contest.status === ContestStatus.COMPLETED ||
        current.contest.status === ContestStatus.ARCHIVED
      ) {
        throw new ConflictError('Closed contests are read-only historical records');
      }
      if (current.status !== SubmissionStatus.PENDING_REVIEW) {
        throw new ConflictError(`Invalid submission status transition from ${current.status}`);
      }
      const updated = {
        ...current,
        status: data.status,
        rejectionReason: data.rejectionReason,
        moderatedById: data.moderatedById,
        moderatedAt: data.moderatedAt,
        updatedAt: data.moderatedAt,
      };
      memory.submissions.set(id, updated);
      return updated;
    }) as typeof SubmissionRepository.applyDecision;

    AuditLogRepository.create = (async (data: CreateAuditLogData) => {
      const submission = memory.submissions.get(data.submissionId);
      const entry: AuditLogRecord = {
        id: `audit-${memory.seq.toString(16).padStart(4, '0')}`,
        submissionId: data.submissionId,
        actorId: data.actorId,
        action: data.action,
        reason: data.reason,
        metadata: data.metadata,
        createdAt: new Date('2026-10-05T12:00:00.000Z'),
        actor: { id: data.actorId, name: 'Moderator' },
        submission: submission
          ? {
              id: submission.id,
              title: submission.title,
              status: submission.status,
              contest: {
                id: submission.contest.id,
                organizationId: submission.contest.organizationId,
              },
              creator: { id: submission.creator.id, name: submission.creator.name },
            }
          : null,
      };
      memory.seq += 1;
      memory.audits.push(entry);
      return entry;
    }) as typeof AuditLogRepository.create;

    AuditLogRepository.list = (async (organizationId?: string) => {
      return memory.audits.filter((entry) => {
        if (!organizationId) return true;
        return entry.submission?.contest.organizationId === organizationId;
      });
    }) as typeof AuditLogRepository.list;
  });

  after(async () => {
    SubmissionRepository.findById = original.findById;
    SubmissionRepository.listPendingReview = original.listPendingReview;
    SubmissionRepository.applyDecision = original.applyDecision;
    AuditLogRepository.create = original.auditCreate;
    AuditLogRepository.list = original.auditList;
    setModerationTransactionRunner(null);
    await app.close();
  });

  function token(role: Role, id: string, organizationId: string | null): string {
    return app.jwt.sign({
      id,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
      organizationId,
    });
  }

  function auth(role: Role, id: string, organizationId: string | null) {
    return { authorization: `Bearer ${token(role, id, organizationId)}` };
  }

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  }

  function seed(
    organizationId: string,
    status: SubmissionStatus = SubmissionStatus.PENDING_REVIEW,
    contestStatus: ContestStatus = ContestStatus.ACTIVE,
  ) {
    const id = `dddddddd-dddd-4ddd-8ddd-${memory.seq.toString(16).padStart(12, '0')}`;
    memory.seq += 1;
    const row = submissionRow(id, organizationId, status, contestStatus);
    memory.submissions.set(id, row);
    return row;
  }

  it('M07-P04-T01 approve pending submission writes APPROVED and an audit row', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/approve`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    const body = response.json();
    assert.equal(response.statusCode, 200);
    assertEnvelope(body, true);
    assert.equal(body.data.status, 'APPROVED');
    assert.equal(body.data.moderatedById, ADMIN_A);
    assert.equal(body.data.rejectionReason, null);
    assert.equal(memory.audits.length, 1);
    assert.equal(memory.audits[0].action, AuditAction.APPROVE);
    assert.equal(memory.audits[0].actorId, ADMIN_A);
    assert.equal(memory.audits[0].submissionId, row.id);
    assert.equal(memory.audits[0].reason, null);
    const metadata = memory.audits[0].metadata as { previousStatus: string; newStatus: string };
    assert.equal(metadata.previousStatus, 'PENDING_REVIEW');
    assert.equal(metadata.newStatus, 'APPROVED');

    const logs = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/moderation/audit-logs',
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
    });
    const logBody = logs.json();
    assert.equal(logs.statusCode, 200);
    assertEnvelope(logBody, true);
    assert.equal(logBody.data.length, 1);
    assert.equal(logBody.data[0].action, 'APPROVE');
    assert.equal(logBody.data[0].actor.id, ADMIN_A);
    assert.equal(logBody.data[0].submission.title, row.title);
    assert.equal(logBody.data[0].submission.creatorName, 'Ada Creator');
  });

  it('M07-P04-T02 reject without a reason returns 400 and does not write', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/reject`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    const body = response.json();
    assert.equal(response.statusCode, 400);
    assertEnvelope(body, false);
    assert.equal(memory.submissions.get(row.id)?.status, SubmissionStatus.PENDING_REVIEW);
    assert.equal(memory.audits.length, 0);

    const blank = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/reject`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: { reason: '   ' },
    });
    assert.equal(blank.statusCode, 400);
    assert.equal(memory.audits.length, 0);
  });

  it('reject with a reason stores REJECTED, the reason, and a REJECT audit row', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/reject`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: { reason: 'Watermark remains visible', reasonCode: 'WATERMARK' },
    });
    const body = response.json();
    assert.equal(response.statusCode, 200);
    assertEnvelope(body, true);
    assert.equal(body.data.status, 'REJECTED');
    assert.equal(body.data.rejectionReason, 'Watermark remains visible');
    assert.equal(memory.audits[0].action, AuditAction.REJECT);
    assert.equal(memory.audits[0].reason, 'Watermark remains visible');
    const metadata = memory.audits[0].metadata as { reasonCode: string; newStatus: string };
    assert.equal(metadata.reasonCode, 'WATERMARK');
    assert.equal(metadata.newStatus, 'REJECTED');
  });

  it('M07-P04-T03 CREATOR and anonymous callers cannot use moderation routes', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const paths: Array<{ method: 'GET' | 'POST'; url: string; payload?: unknown }> = [
      { method: 'GET', url: '/api/v1/admin/moderation/queue' },
      { method: 'GET', url: '/api/v1/admin/moderation/audit-logs' },
      { method: 'POST', url: `/api/v1/admin/submissions/${row.id}/approve`, payload: {} },
      {
        method: 'POST',
        url: `/api/v1/admin/submissions/${row.id}/reject`,
        payload: { reason: 'No' },
      },
    ];

    for (const path of paths) {
      const creator = await app.inject({
        method: path.method,
        url: path.url,
        headers: auth(Role.CREATOR, CREATOR_ID, null),
        payload: path.payload,
      });
      assert.equal(creator.statusCode, 403, path.url);
      assertEnvelope(creator.json(), false);

      const viewer = await app.inject({
        method: path.method,
        url: path.url,
        headers: auth(Role.VIEWER, CREATOR_ID, null),
        payload: path.payload,
      });
      assert.equal(viewer.statusCode, 403, path.url);

      const anon = await app.inject({
        method: path.method,
        url: path.url,
        payload: path.payload,
      });
      assert.equal(anon.statusCode, 401, path.url);
    }
    assert.equal(memory.audits.length, 0);
    assert.equal(memory.submissions.get(row.id)?.status, SubmissionStatus.PENDING_REVIEW);
  });

  it('scopes the queue and decisions to the brand admin organization', async () => {
    memory = createMemory();
    const own = seed(ORG_A);
    const foreign = seed(ORG_B);
    seed(ORG_A, SubmissionStatus.APPROVED);

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/moderation/queue',
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
    });
    const queueBody = queue.json();
    assert.equal(queue.statusCode, 200);
    assertEnvelope(queueBody, true);
    assert.deepEqual(
      queueBody.data.map((item: { id: string }) => item.id),
      [own.id],
    );
    assert.equal(queueBody.data[0].creator.name, 'Ada Creator');
    assert.equal(queueBody.data[0].status, 'PENDING_REVIEW');

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${foreign.id}/approve`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    assert.equal(denied.statusCode, 403);
    assertEnvelope(denied.json(), false);
    assert.equal(memory.submissions.get(foreign.id)?.status, SubmissionStatus.PENDING_REVIEW);

    const superQueue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/moderation/queue',
      headers: auth(Role.SUPER_ADMIN, SUPER_ID, null),
    });
    const superIds = superQueue.json().data.map((item: { id: string }) => item.id).sort();
    assert.deepEqual(superIds, [own.id, foreign.id].sort());

    const cross = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${foreign.id}/approve`,
      headers: auth(Role.SUPER_ADMIN, SUPER_ID, null),
      payload: { note: 'Cleared' },
    });
    assert.equal(cross.statusCode, 200);
    assert.equal(cross.json().data.status, 'APPROVED');
    assert.equal(memory.audits.at(-1)?.reason, 'Cleared');

    const foreignLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/moderation/audit-logs',
      headers: auth(Role.BRAND_ADMIN, ADMIN_B, ORG_B),
    });
    assert.equal(foreignLogs.json().data.length, 1);
    assert.equal(foreignLogs.json().data[0].submissionId, foreign.id);

    const ownLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/moderation/audit-logs',
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
    });
    assert.equal(ownLogs.json().data.length, 0);
  });

  it('rejects invalid transitions and moderation of closed contests', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/approve`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/reject`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: { reason: 'Changed my mind' },
    });
    assert.equal(second.statusCode, 409);
    assertEnvelope(second.json(), false);
    assert.equal(memory.submissions.get(row.id)?.status, SubmissionStatus.APPROVED);

    const archived = seed(ORG_A, SubmissionStatus.PENDING_REVIEW, ContestStatus.ARCHIVED);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${archived.id}/approve`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.json().message, /read-only/);
    assert.equal(memory.submissions.get(archived.id)?.status, SubmissionStatus.PENDING_REVIEW);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/submissions/11111111-1111-4111-8111-111111111111/approve',
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: {},
    });
    assert.equal(missing.statusCode, 404);
  });

  it('flags through the service only and does not register a flag route', async () => {
    memory = createMemory();
    const row = seed(ORG_A);
    const decision = await ModerationService.flag(
      { id: ADMIN_A, role: Role.BRAND_ADMIN, organizationId: ORG_A },
      row.id,
      'Needs a senior look',
    );
    assert.equal(decision.submission.status, SubmissionStatus.FLAGGED);
    assert.equal(decision.audit.action, AuditAction.FLAG);
    assert.equal(decision.audit.reason, 'Needs a senior look');

    const route = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/submissions/${row.id}/flag`,
      headers: auth(Role.BRAND_ADMIN, ADMIN_A, ORG_A),
      payload: { reason: 'Needs a senior look' },
    });
    assert.equal(route.statusCode, 404);

    const again = await ModerationService.approve(
      { id: ADMIN_A, role: Role.BRAND_ADMIN, organizationId: ORG_A },
      row.id,
    ).then(
      () => 'approved',
      (error: unknown) => error,
    );
    assert.ok(again instanceof ConflictError);
  });

  it('M10 tenant list and suspend require authentication', async () => {
    const orgs = await app.inject({
      method: 'GET',
      url: '/api/v1/super-admin/organizations',
    });
    assert.equal(orgs.statusCode, 401);

    const suspend = await app.inject({
      method: 'POST',
      url: `/api/v1/super-admin/organizations/${ORG_A}/suspend`,
    });
    assert.equal(suspend.statusCode, 401);
  });
});
