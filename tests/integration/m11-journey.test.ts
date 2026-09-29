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
 * The presign signer is a test adapter. The video bytes are not sent to S3.
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
  const userIds: string[] = [];
  const orgIds: string[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    await prisma.$queryRawUnsafe('SELECT 1');
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
    if (orgIds.length > 0) {
      await prisma.rating.deleteMany({
        where: { submission: { contest: { organizationId: { in: orgIds } } } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: userIds } },
            { submission: { contest: { organizationId: { in: orgIds } } } },
          ],
        },
      });
      await prisma.submission.deleteMany({
        where: { contest: { organizationId: { in: orgIds } } },
      });
      await prisma.contest.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
    } else if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (orgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    if (app) await app.close();
  });

  it(
    'M11-P02 brand theme contest, creator upload, approve, rate, leaderboard, suspend',
    { timeout: 120_000 },
    async () => {
      const suffix = uniqueSuffix();
      const password = 'password123';
      const slug = `m11-${suffix}`.slice(0, 50);

      const organization = await prisma.organization.create({
        data: {
          name: `M11 Org ${suffix}`,
          slug,
        },
      });
      const organizationId = organization.id;
      orgIds.push(organizationId);
      const brandUser = await prisma.user.create({
        data: {
          email: `m11-brand-${suffix}@contestos.test`,
          passwordHash: await hashPassword(password),
          name: 'M11 Brand Admin',
          role: Role.BRAND_ADMIN,
          organizationId,
        },
      });
      userIds.push(brandUser.id);
      const brandLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: brandUser.email, password },
      });
      assert.equal(brandLogin.statusCode, 200);
      const brandBody = JSON.parse(brandLogin.payload);
      assertEnvelope(brandBody, true);
      assert.equal(brandBody.data.user.role, Role.BRAND_ADMIN);
      const brandToken = brandBody.data.token as string;
      const brandAuth = { authorization: `Bearer ${brandToken}` };

      const themeRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/organizations/${organizationId}/branding`,
        headers: brandAuth,
        payload: {
          primaryColor: '#112233',
          logoUrl: 'https://example.com/m11-logo.png',
          accentColor: '#445566',
          tagline: 'M11 theme',
        },
      });
      assert.equal(themeRes.statusCode, 200);
      const themeBody = JSON.parse(themeRes.payload);
      assertEnvelope(themeBody, true);
      assert.equal(themeBody.data.branding.primaryColor, '#112233');
      assert.equal(themeBody.data.branding.tagline, 'M11 theme');
      assert.equal(themeBody.data.status, 'ACTIVE');

      const startDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/contests',
        headers: brandAuth,
        payload: {
          organizationId,
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

      const scheduled = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${contestId}`,
        headers: brandAuth,
        payload: { status: 'SCHEDULED' },
      });
      assert.equal(scheduled.statusCode, 200);
      assert.equal(JSON.parse(scheduled.payload).data.status, 'SCHEDULED');

      const active = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${contestId}`,
        headers: brandAuth,
        payload: { status: 'ACTIVE' },
      });
      assert.equal(active.statusCode, 200);
      assert.equal(JSON.parse(active.payload).data.status, 'ACTIVE');
      assert.equal(JSON.parse(active.payload).data.autoAdvanceDelayMs, 1800);

      const creatorUser = await prisma.user.create({
        data: {
          email: `m11-creator-${suffix}@contestos.test`,
          passwordHash: await hashPassword(password),
          name: 'M11 Creator',
          role: Role.CREATOR,
          organizationId,
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
      assert.equal(creatorBody.data.user.organizationId, organizationId);
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
      assert.equal(presignBody.data.method, 'PUT');
      assert.match(presignBody.data.uploadUrl, /X-Amz-Signature=m11/);

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

      const mine = await app.inject({
        method: 'GET',
        url: '/api/v1/submissions/me',
        headers: creatorAuth,
      });
      assert.equal(mine.statusCode, 200);
      assert.equal(
        JSON.parse(mine.payload).data.some(
          (row: { id: string }) => row.id === submissionId,
        ),
        true,
      );

      const approve = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/submissions/${submissionId}/approve`,
        headers: brandAuth,
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
      assertEnvelope(queueBody, true);
      assert.equal(queueBody.data.autoAdvanceDelayMs, 1800);
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
      const rateBody = JSON.parse(rate.payload);
      assertEnvelope(rateBody, true);
      assert.equal(rateBody.data.newScore, 5);
      assert.equal(rateBody.data.totalVotes, 1);
      assert.equal(rateBody.data.delta, 5);

      const board = await app.inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/leaderboard`,
      });
      assert.equal(board.statusCode, 200);
      const boardBody = JSON.parse(board.payload);
      assertEnvelope(boardBody, true);
      assert.equal(boardBody.data.items.length, 1);
      assert.equal(boardBody.data.items[0].id, submissionId);
      assert.equal(boardBody.data.items[0].rank, 1);
      assert.equal(boardBody.data.items[0].communityScore, 5);
      assert.equal(boardBody.data.items[0].totalVotes, 1);
      assert.equal(boardBody.data.podium[0].id, submissionId);

      const superAdmin = await prisma.user.create({
        data: {
          email: `m11-super-${suffix}@contestos.test`,
          passwordHash: await hashPassword(password),
          name: 'M11 Super Admin',
          role: Role.SUPER_ADMIN,
        },
      });
      userIds.push(superAdmin.id);

      const superLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: superAdmin.email, password },
      });
      assert.equal(superLogin.statusCode, 200);
      const superBody = JSON.parse(superLogin.payload);
      assertEnvelope(superBody, true);
      assert.equal(superBody.data.user.role, Role.SUPER_ADMIN);
      const superAuth = { authorization: `Bearer ${superBody.data.token}` };

      const denied = await app.inject({
        method: 'POST',
        url: `/api/v1/super-admin/organizations/${organizationId}/suspend`,
        headers: brandAuth,
        payload: { reason: 'Brand admin must not suspend' },
      });
      assert.equal(denied.statusCode, 403);

      const suspend = await app.inject({
        method: 'POST',
        url: `/api/v1/super-admin/organizations/${organizationId}/suspend`,
        headers: superAuth,
        payload: { reason: 'M11 journey suspension' },
      });
      assert.equal(suspend.statusCode, 200);
      const suspendBody = JSON.parse(suspend.payload);
      assertEnvelope(suspendBody, true);
      assert.equal(suspendBody.data.status, 'SUSPENDED');
      assert.equal(suspendBody.data.suspensionReason, 'M11 journey suspension');

      const branding = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${slug}/branding`,
      });
      assert.equal(branding.statusCode, 200);
      const brandingBody = JSON.parse(branding.payload);
      assertEnvelope(brandingBody, true);
      assert.equal(brandingBody.data.status, 'SUSPENDED');
      assert.equal(brandingBody.data.suspensionReason, undefined);

      const blocked = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${contestId}`,
        headers: brandAuth,
        payload: { title: 'Should not apply' },
      });
      assert.equal(blocked.statusCode, 409);
    },
  );
});
