import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { SendEmailOptions, SendEmailResult } from '../../src/services/email/email-provider.interface.js';
import { JWTPayload } from '../../src/types/auth.js';

const ENVELOPE_KEYS = ['success', 'message', 'data', 'errors'];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertFrozenEnvelope(body: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(body).sort(), [...ENVELOPE_KEYS].sort());
}

function assertNoPasswordHash(value: unknown): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes('passwordHash'), false);
  assert.equal(json.includes('password123'), false);
}

describe('M02-P03 auth flow integration (persisted Prisma, no repository mocks)', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    await prisma.$queryRawUnsafe('SELECT 1');
  });

  after(async () => {
    EmailService.setProvider(null);
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  describe('M02-P03-T01 creator register → login → me', () => {
    it('registers a creator, logs in with the same credentials, and GET /auth/me returns the persisted profile', async () => {
      const suffix = uniqueSuffix();
      const email = `m02p03-t01-creator-${suffix}@contestos.test`;
      const password = 'password123';
      const name = 'M02 P03 T01 Creator';

      const sent: SendEmailOptions[] = [];
      EmailService.setProvider({
        name: 'test',
        isConfigured: () => true,
        async sendEmail(options) {
          sent.push(options);
          return { delivered: true, provider: 'test' } satisfies SendEmailResult;
        },
      });

      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/creator',
        payload: { email, password, name },
      });

      assert.equal(registerRes.statusCode, 201);
      const registerBody = JSON.parse(registerRes.payload);
      assertFrozenEnvelope(registerBody);
      assert.equal(registerBody.success, true);
      assert.equal(registerBody.message, 'Check your email to verify your account before signing in.');
      assert.equal(registerBody.errors, null);
      assert.equal(registerBody.data, null);
      assertNoPasswordHash(registerBody);
      assert.equal(sent.length, 1);

      const persisted = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          passwordHash: true,
        },
      });
      assert.ok(persisted);
      assert.equal(persisted.role, Role.CREATOR);
      assert.ok(persisted.passwordHash.startsWith('$2'));
      assert.notEqual(persisted.passwordHash, password);

      const wrongPasswordRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      assert.equal(wrongPasswordRes.statusCode, 401);
      const wrongPasswordBody = JSON.parse(wrongPasswordRes.payload);
      assertFrozenEnvelope(wrongPasswordBody);
      assert.equal(wrongPasswordBody.success, false);
      assert.equal(wrongPasswordBody.message, 'Invalid email or password');
      assert.equal(wrongPasswordBody.data, null);
      createdUserIds.push(persisted.id);

      const unverifiedLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      assert.equal(unverifiedLogin.statusCode, 403);
      assert.equal(JSON.parse(unverifiedLogin.payload).message, 'Verify your email before signing in.');

      const token = sent[0].text.match(/token=([a-f0-9]+)/)?.[1];
      assert.ok(token);
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token },
      });
      assert.equal(verifyRes.statusCode, 200);
      assert.equal(JSON.parse(verifyRes.payload).data.verified, true);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      assert.equal(loginRes.statusCode, 200);
      const loginBody = JSON.parse(loginRes.payload);
      assertFrozenEnvelope(loginBody);
      assert.equal(loginBody.success, true);
      assert.equal(loginBody.message, 'Login successful');
      assert.equal(loginBody.errors, null);
      assert.equal(loginBody.data.user.id, persisted.id);
      assert.equal(loginBody.data.user.email, email);
      assert.equal(loginBody.data.user.role, Role.CREATOR);
      assert.equal(typeof loginBody.data.token, 'string');
      assert.ok(loginBody.data.token.length > 0);
      assertNoPasswordHash(loginBody);

      const loginClaims = app.jwt.verify<JWTPayload>(loginBody.data.token);
      assert.equal(loginClaims.id, persisted.id);
      assert.equal(loginClaims.email, email);
      assert.equal(loginClaims.role, Role.CREATOR);
      assert.equal('organizationId' in loginClaims, false);

      const unauthenticatedMe = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });
      assert.equal(unauthenticatedMe.statusCode, 401);
      const unauthenticatedBody = JSON.parse(unauthenticatedMe.payload);
      assertFrozenEnvelope(unauthenticatedBody);
      assert.equal(unauthenticatedBody.success, false);
      assert.equal(unauthenticatedBody.data, null);

      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${loginBody.data.token}` },
      });
      assert.equal(meRes.statusCode, 200);
      const meBody = JSON.parse(meRes.payload);
      assertFrozenEnvelope(meBody);
      assert.equal(meBody.success, true);
      assert.equal(meBody.message, 'User profile retrieved successfully');
      assert.equal(meBody.errors, null);
      assert.equal(meBody.data.id, persisted.id);
      assert.equal(meBody.data.email, email);
      assert.equal(meBody.data.name, name);
      assert.equal(meBody.data.role, Role.CREATOR);
      assert.equal('organizationId' in meBody.data, false);
      assertNoPasswordHash(meBody);
    });
  });

  describe('brand registration is not customer-facing', () => {
    it('POST /api/v1/auth/register/brand is not registered', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/brand',
        payload: {
          email: 'brand@contestos.test',
          password: 'password123',
          name: 'Brand Admin',
          organizationName: 'New Org',
          slug: 'new-org',
        },
      });
      assert.equal(res.statusCode, 404);
    });
  });
});
