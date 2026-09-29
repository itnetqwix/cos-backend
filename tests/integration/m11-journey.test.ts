import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { hashPassword } from '../../src/utils/crypto.js';
import {
  getStorageService,
  setStorageService,
  type StorageService,
} from '../../src/services/storage.service.js';

/**
 * M11-P02 cross-module journey through the HTTP API.
 * Rows are created by the real services and deleted in after().
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
  assert.deepEqual(Object.keys(body).sort(), [...ENVELOPE_KEYS].sort());
  assert.equal(body.success, success);
  assert.equal(JSON.stringify(body).includes('passwordHash'), false);
}

describe('M11 cross-module journey', { concurrency: false }, () => {
  let app: FastifyInstance;
  let previousStorage: StorageService | null = null;
  let databaseMatchesProductSchema = false;
  const userIds: string[] = [];
  const contestIds: string[] = [];
  const categoryIds: string[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    await prisma.$queryRawUnsafe('SELECT 1');
    const legacyOrgColumn = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'contests'
          AND column_name = 'organizationId'
      ) AS "exists"`,
    );
    databaseMatchesProductSchema = legacyOrgColumn[0]?.exists !== true;
    try {
      previousStorage = getStorageService();
    } catch {
      previousStorage = null;
    }
    setStorageService({
      createPresignedUpload: async ({ objectKey, contentType }) => ({
        uploadUrl: `https://cos-test-bucket.s3.amazonaws.com/${objectKey}?X-Amz-Signature=m11`,
        objectKey,
        headers: { 'Content-Type': contentType },
        expiresInSeconds: 900,
        method: 'PUT',
      }),
      getPublicUrl: (objectKey) =>
        `https://cos-test-bucket.s3.amazonaws.com/${objectKey}`,
    });
  });

  after(async () => {
    setStorageService(previousStorage);
    if (contestIds.length > 0) {
      await prisma.rating.deleteMany({
        where: { submission: { contestId: { in: contestIds } } },
      });
      await prisma.auditLog.deleteMany({
        where: { submission: { contestId: { in: contestIds } } },
      });
      await prisma.submission.deleteMany({ where: { contestId: { in: contestIds } } });
      await prisma.contest.deleteMany({ where: { id: { in: contestIds } } });
    }
    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    }
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it(
    'M11-P02 admin contest, creator upload, approve, rate, leaderboard',
    { timeout: 120_000 },
    async (t) => {
      if (!databaseMatchesProductSchema) {
        t.skip(
          'Database still has organization-scoped contests; apply Prisma migrations to run this journey',
        );
      }
      const suffix = uniqueSuffix();
      const password = 'password123';

      const adminUser = await prisma.user.create({
        data: {
          email: `m11-admin-${suffix}@contestos.test`,
          passwordHash: await hashPassword(password),
          name: 'M11 Admin',
          role: Role.ADMIN,
        },
      });
      userIds.push(adminUser.id);
      const adminAuth = {
        authorization: `Bearer ${app.jwt.sign({
          id: adminUser.id,
          email: adminUser.email,
          role: Role.ADMIN,
        })}`,
      };

      const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/contests',
        headers: adminAuth,
        payload: {
          title: 'M11 Journey Contest',
          description: 'Cross-module integration contest.',
          startDate,
          endDate,
          prizeSummary: '1000 USD',
          rules: ['Be original'],
          autoAdvanceDelayMs: 1800,
        },
      });
      assert.equal(createRes.statusCode, 201);
      const createBody = JSON.parse(createRes.payload);
      assertEnvelope(createBody, true);
      assert.equal(createBody.data.status, 'DRAFT');
      const contestId = createBody.data.id as string;
      contestIds.push(contestId);
      if (createBody.data.categoryId) {
        categoryIds.push(createBody.data.categoryId as string);
      }

      for (const status of ['SCHEDULED', 'ACTIVE'] as const) {
        const step = await app.inject({
          method: 'PATCH',
          url: `/api/v1/contests/${contestId}`,
          headers: adminAuth,
          payload: { status },
        });
        assert.equal(step.statusCode, 200);
        assert.equal(JSON.parse(step.payload).data.status, status);
      }

      const creatorUser = await prisma.user.create({
        data: {
          email: `m11-creator-${suffix}@contestos.test`,
          passwordHash: await hashPassword(password),
          name: 'M11 Creator',
          role: Role.CREATOR,
        },
      });
      userIds.push(creatorUser.id);
      const creatorLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: creatorUser.email, password },
      });
      assert.equal(creatorLogin.statusCode, 200);
      const creatorBody = JSON.parse(creatorLogin.payload);
      assertEnvelope(creatorBody, true);
      assert.equal(creatorBody.data.user.role, Role.CREATOR);
      const creatorAuth = { authorization: `Bearer ${creatorBody.data.token}` };

      const discovery = await app.inject({
        method: 'GET',
        url: '/api/v1/contests',
        headers: creatorAuth,
      });
      assert.equal(discovery.statusCode, 403);

      const presign = await app.inject({
        method: 'POST',
        url: '/api/v1/submissions/presign',
        headers: creatorAuth,
        payload: {
          contestId,
          contentType: 'video/mp4',
          fileSizeBytes: 4_000_000,
          durationSeconds: 42,
        },
      });
      assert.equal(presign.statusCode, 200);
      const presignBody = JSON.parse(presign.payload);
      assertEnvelope(presignBody, true);
      assert.match(presignBody.data.objectKey, new RegExp(`^contests/${contestId}/creators/`));

      const complete = await app.inject({
        method: 'POST',
        url: '/api/v1/submissions/complete',
        headers: creatorAuth,
        payload: {
          contestId,
          objectKey: presignBody.data.objectKey,
          title: 'M11 Journey Clip',
          description: 'Integration entry',
          durationSeconds: 42,
          tags: ['#M11'],
        },
      });
      assert.equal(complete.statusCode, 201);
      const completeBody = JSON.parse(complete.payload);
      assertEnvelope(completeBody, true);
      assert.equal(completeBody.data.status, 'PENDING_REVIEW');
      const submissionId = completeBody.data.id as string;

      const approve = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/submissions/${submissionId}/approve`,
        headers: adminAuth,
        payload: {},
      });
      assert.equal(approve.statusCode, 200);
      assert.equal(JSON.parse(approve.payload).data.status, 'APPROVED');

      const queue = await app.inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/queue`,
      });
      assert.equal(queue.statusCode, 200);
      const queueBody = JSON.parse(queue.payload);
      assert.equal(
        queueBody.data.items.some((item: { id: string }) => item.id === submissionId),
        true,
      );

      const rate = await app.inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/videos/${submissionId}/rate`,
        payload: { rating: 5 },
      });
      assert.equal(rate.statusCode, 200);
      assert.equal(JSON.parse(rate.payload).data.newScore, 5);

      const board = await app.inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/leaderboard`,
      });
      assert.equal(board.statusCode, 200);
      const boardBody = JSON.parse(board.payload);
      assert.equal(boardBody.data.items.length, 1);
      assert.equal(boardBody.data.items[0].id, submissionId);
    },
  );
});
