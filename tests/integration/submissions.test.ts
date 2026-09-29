import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FastifyInstance } from 'fastify';
import { ContestStatus, Role, SubmissionStatus } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import { ContestRecord, ContestRepository } from '../../src/repositories/contest.repository.js';
import {
  CreateSubmissionData,
  SubmissionRecord,
  SubmissionRepository,
} from '../../src/repositories/submission.repository.js';
import { buildSubmissionObjectKey, setStorageService } from '../../src/services/storage.service.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const CREATOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000aa';
const CREATOR_B = 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000bb';
const MISSING_CONTEST = '11111111-1111-4111-8111-111111111111';

interface Memory {
  contests: Map<string, ContestRecord>;
  submissions: Map<string, SubmissionRecord>;
  seq: number;
}

function uuid(n: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${n.toString(16).padStart(12, '0')}`;
}

function createMemory(): Memory {
  return { contests: new Map(), submissions: new Map(), seq: 1 };
}

function contestRow(id: string, status: ContestStatus): ContestRecord {
  const now = new Date('2026-10-01T00:00:00.000Z');
  return {
    id,
    categoryId: null,
    category: null,
    title: status === ContestStatus.ACTIVE ? 'Active Slam' : 'Inactive Slam',
    description: 'Short comedy entries.',
    status,
    startDate: now,
    endDate: new Date('2026-10-31T00:00:00.000Z'),
    prizeSummary: '25000 USD',
    rules: ['Be original'],
    autoAdvanceDelayMs: 1800,
    createdAt: now,
    updatedAt: now,
  };
}

describe('M06 submission APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let memory: Memory;
  let signedKeys: string[];

  const originalContestFind = ContestRepository.findById;
  const originalSubmission = {
    create: SubmissionRepository.create,
    findById: SubmissionRepository.findById,
    findByObjectKey: SubmissionRepository.findByObjectKey,
    listByCreatorId: SubmissionRepository.listByCreatorId,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    setStorageService({
      createPresignedUpload: async ({ objectKey, contentType }) => {
        signedKeys.push(objectKey);
        return {
          uploadUrl: `https://cos-test-bucket.s3.us-east-1.amazonaws.com/${objectKey}?X-Amz-Signature=mock`,
          objectKey,
          headers: { 'Content-Type': contentType },
          expiresInSeconds: VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS,
          method: 'PUT',
        };
      },
      getPublicUrl: (objectKey) =>
        `https://cos-test-bucket.s3.us-east-1.amazonaws.com/${objectKey}`,
    });

    app = await buildApp();
    await app.ready();
    memory = createMemory();
    signedKeys = [];

    ContestRepository.findById = (async (id: string) =>
      memory.contests.get(id) ?? null) as typeof ContestRepository.findById;

    SubmissionRepository.create = (async (data: CreateSubmissionData) => {
      const now = new Date('2026-10-04T00:00:00.000Z');
      const contest = memory.contests.get(data.contestId);
      const row: SubmissionRecord = {
        id: `dddddddd-dddd-4ddd-8ddd-${memory.seq.toString(16).padStart(12, '0')}`,
        contestId: data.contestId,
        creatorId: data.creatorId,
        title: data.title,
        description: data.description,
        videoUrl: data.videoUrl,
        objectKey: data.objectKey,
        thumbnailUrl: data.thumbnailUrl,
        durationSeconds: data.durationSeconds,
        status: SubmissionStatus.PENDING_REVIEW,
        rejectionReason: null,
        moderatedById: null,
        moderatedAt: null,
        tags: data.tags,
        communityScore: 0,
        totalVotes: 0,
        createdAt: now,
        updatedAt: now,
        contest: contest
          ? {
              id: contest.id,
              title: contest.title,
              status: contest.status,
              category: contest.category
                ? { id: contest.category.id, name: contest.category.name, slug: contest.category.slug }
                : null,
            }
          : {
              id: data.contestId,
              title: 'Unknown',
              status: ContestStatus.ACTIVE,
              category: null,
            },
      };
      memory.seq += 1;
      memory.submissions.set(row.id, row);
      return row;
    }) as typeof SubmissionRepository.create;

    SubmissionRepository.findById = (async (id: string) =>
      memory.submissions.get(id) ?? null) as typeof SubmissionRepository.findById;

    SubmissionRepository.findByObjectKey = (async (objectKey: string) => {
      for (const row of memory.submissions.values()) {
        if (row.objectKey === objectKey) return row;
      }
      return null;
    }) as typeof SubmissionRepository.findByObjectKey;

    SubmissionRepository.listByCreatorId = (async (creatorId: string) =>
      [...memory.submissions.values()]
        .filter((row) => row.creatorId === creatorId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) as typeof SubmissionRepository.listByCreatorId;
  });

  after(async () => {
    ContestRepository.findById = originalContestFind;
    SubmissionRepository.create = originalSubmission.create;
    SubmissionRepository.findById = originalSubmission.findById;
    SubmissionRepository.findByObjectKey = originalSubmission.findByObjectKey;
    SubmissionRepository.listByCreatorId = originalSubmission.listByCreatorId;
    setStorageService(null);
    await app.close();
  });

  function token(role: Role, id = CREATOR_A): string {
    return app.jwt.sign({
      id,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
    });
  }

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  }

  function seedActive(): ContestRecord {
    const row = contestRow(uuid(memory.seq++), ContestStatus.ACTIVE);
    memory.contests.set(row.id, row);
    return row;
  }

  it('M06-P05-T01 ACTIVE contest → presign → complete → PENDING_REVIEW', async () => {
    memory = createMemory();
    signedKeys = [];
    const contest = seedActive();
    const auth = { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` };

    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: {
        contestId: contest.id,
        contentType: 'video/mp4',
        fileSizeBytes: 4_000_000,
        durationSeconds: 42,
      },
    });
    assert.equal(presign.statusCode, 200);
    const presignBody = JSON.parse(presign.payload);
    assertEnvelope(presignBody, true);
    assert.equal(presignBody.data.method, 'PUT');
    assert.match(presignBody.data.uploadUrl, /X-Amz-Signature=mock/);
    assert.equal(presignBody.data.headers['Content-Type'], 'video/mp4');
    assert.match(
      presignBody.data.objectKey,
      new RegExp(`^contests/${contest.id}/creators/${CREATOR_A}/`),
    );
    assert.equal(signedKeys.length, 1);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/complete',
      headers: auth,
      payload: {
        contestId: contest.id,
        objectKey: presignBody.data.objectKey,
        title: 'Quantum Coffee Spill',
        description: 'Late night VFX skit',
        durationSeconds: 42,
        tags: ['#ViralComedy'],
      },
    });
    assert.equal(complete.statusCode, 201);
    const completeBody = JSON.parse(complete.payload);
    assertEnvelope(completeBody, true);
    assert.equal(completeBody.data.status, 'PENDING_REVIEW');
    assert.equal(completeBody.data.creatorId, CREATOR_A);
    assert.equal(completeBody.data.communityScore, 0);
    assert.equal(completeBody.data.totalVotes, 0);
    assert.match(completeBody.data.videoUrl, /cos-test-bucket/);

    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/complete',
      headers: auth,
      payload: {
        contestId: contest.id,
        objectKey: presignBody.data.objectKey,
        title: 'Quantum Coffee Spill',
        durationSeconds: 42,
      },
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(JSON.parse(retry.payload).data.id, completeBody.data.id);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/submissions/me',
      headers: auth,
    });
    assert.equal(mine.statusCode, 200);
    assert.equal(JSON.parse(mine.payload).data.length, 1);

    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/submissions/${completeBody.data.id}`,
      headers: auth,
    });
    assert.equal(one.statusCode, 200);
    assert.equal(JSON.parse(one.payload).data.title, 'Quantum Coffee Spill');
  });

  it('M06-P05-T02 rejects non-ACTIVE contests and unknown contests', async () => {
    memory = createMemory();
    const draft = contestRow(uuid(memory.seq++), ContestStatus.DRAFT);
    const judging = contestRow(uuid(memory.seq++), ContestStatus.JUDGING);
    memory.contests.set(draft.id, draft);
    memory.contests.set(judging.id, judging);
    const auth = { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` };
    const payload = {
      contestId: draft.id,
      contentType: 'video/webm',
      fileSizeBytes: 1000,
      durationSeconds: 10,
    };

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload,
    });
    assert.equal(draftRes.statusCode, 400);
    assert.match(JSON.parse(draftRes.payload).message, /ACTIVE/);

    const judgingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: { ...payload, contestId: judging.id },
    });
    assert.equal(judgingRes.statusCode, 400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: { ...payload, contestId: MISSING_CONTEST },
    });
    assert.equal(missing.statusCode, 404);
    assertEnvelope(JSON.parse(missing.payload), false);
  });

  it('M06-P05-T03 rejects invalid content-type and oversize at presign', async () => {
    memory = createMemory();
    const contest = seedActive();
    const auth = { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` };

    const type = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: {
        contestId: contest.id,
        contentType: 'video/quicktime',
        fileSizeBytes: 1000,
        durationSeconds: 10,
      },
    });
    assert.equal(type.statusCode, 400);

    const size = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: {
        contestId: contest.id,
        contentType: 'video/mp4',
        fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
        durationSeconds: 10,
      },
    });
    assert.equal(size.statusCode, 400);

    const duration = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      headers: auth,
      payload: {
        contestId: contest.id,
        contentType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 61,
      },
    });
    assert.equal(duration.statusCode, 400);
  });

  it('rejects unauthenticated, wrong role, foreign objectKey, and other-creator reads', async () => {
    memory = createMemory();
    const contest = seedActive();

    const unauth = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/presign',
      payload: {
        contestId: contest.id,
        contentType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
      },
    });
    assert.equal(unauth.statusCode, 401);
    assertEnvelope(JSON.parse(unauth.payload), false);

    for (const role of [Role.ADMIN]) {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/submissions/presign',
        headers: {
          authorization: `Bearer ${token(role, CREATOR_B)}`,
        },
        payload: {
          contestId: contest.id,
          contentType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        },
      });
      assert.equal(denied.statusCode, 403, role);
    }

    const stolenKey = buildSubmissionObjectKey({
      contestId: contest.id,
      creatorId: CREATOR_B,
      contentType: 'video/mp4',
      objectId: 'cccccccc-cccc-4ccc-8ccc-000000000099',
    });
    const stolen = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/complete',
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` },
      payload: {
        contestId: contest.id,
        objectKey: stolenKey,
        title: 'Stolen',
        durationSeconds: 10,
      },
    });
    assert.equal(stolen.statusCode, 403);

    const ownKey = buildSubmissionObjectKey({
      contestId: contest.id,
      creatorId: CREATOR_A,
      contentType: 'video/webm',
      objectId: 'cccccccc-cccc-4ccc-8ccc-000000000088',
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions/complete',
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_A)}` },
      payload: {
        contestId: contest.id,
        objectKey: ownKey,
        title: 'Mine',
        durationSeconds: 12,
      },
    });
    assert.equal(created.statusCode, 201);
    const id = JSON.parse(created.payload).data.id;

    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/submissions/${id}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, CREATOR_B)}` },
    });
    assert.equal(other.statusCode, 404);

    const adminPeek = await app.inject({
      method: 'GET',
      url: '/api/v1/submissions/me',
      headers: { authorization: `Bearer ${token(Role.ADMIN, CREATOR_B)}` },
    });
    assert.equal(adminPeek.statusCode, 403);
  });

  it('M06-P05-T04 Fastify has no video binary upload path', () => {
    const routes = readFileSync(new URL('../../src/routes/index.ts', import.meta.url), 'utf8');
    const appSrc = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(routes, /fastify\.(post|get)\(\s*'\/submissions\/upload'/);
    assert.doesNotMatch(routes, /multipart/);
    assert.doesNotMatch(appSrc, /@fastify\/multipart/);
    assert.doesNotMatch(appSrc, /fileUpload/);
  });
});
