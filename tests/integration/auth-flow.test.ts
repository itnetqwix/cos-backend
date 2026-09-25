import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
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
  const createdOrgIds: string[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    await prisma.$queryRawUnsafe('SELECT 1');
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    await app.close();
  });

  describe('M02-P03-T01 creator register → login → me', () => {
    it('registers a creator, logs in with the same credentials, and GET /auth/me returns the persisted profile', async () => {
      const suffix = uniqueSuffix();
      const email = `m02p03-t01-creator-${suffix}@contestos.test`;
      const password = 'password123';
      const name = 'M02 P03 T01 Creator';

      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/creator',
        payload: { email, password, name },
      });

      assert.equal(registerRes.statusCode, 201);
      const registerBody = JSON.parse(registerRes.payload);
      assertFrozenEnvelope(registerBody);
      assert.equal(registerBody.success, true);
      assert.equal(registerBody.message, 'Creator account created successfully');
      assert.equal(registerBody.errors, null);
      assert.equal(registerBody.data.user.email, email);
      assert.equal(registerBody.data.user.name, name);
      assert.equal(registerBody.data.user.role, Role.CREATOR);
      assert.equal(registerBody.data.user.organizationId, null);
      assert.equal(typeof registerBody.data.token, 'string');
      assert.ok(registerBody.data.token.length > 0);
      assertNoPasswordHash(registerBody);
      createdUserIds.push(registerBody.data.user.id);

      const registerClaims = app.jwt.verify<JWTPayload>(registerBody.data.token);
      assert.equal(registerClaims.id, registerBody.data.user.id);
      assert.equal(registerClaims.email, email);
      assert.equal(registerClaims.role, Role.CREATOR);
      assert.equal(registerClaims.organizationId, null);

      const persisted = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          organizationId: true,
          passwordHash: true,
        },
      });
      assert.ok(persisted);
      assert.equal(persisted.role, Role.CREATOR);
      assert.equal(persisted.organizationId, null);
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
      assert.equal(loginBody.data.user.organizationId, null);
      assert.equal(typeof loginBody.data.token, 'string');
      assert.ok(loginBody.data.token.length > 0);
      assertNoPasswordHash(loginBody);

      const loginClaims = app.jwt.verify<JWTPayload>(loginBody.data.token);
      assert.equal(loginClaims.id, persisted.id);
      assert.equal(loginClaims.email, email);
      assert.equal(loginClaims.role, Role.CREATOR);
      assert.equal(loginClaims.organizationId, null);

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
      assert.equal(meBody.data.organizationId, null);
      assertNoPasswordHash(meBody);
    });
  });

  describe('M02-P03-T02 brand register → org created → me has organizationId', () => {
    it('registers a brand, persists the organization, and GET /auth/me returns organizationId', async () => {
      const suffix = uniqueSuffix();
      const email = `m02p03-t02-brand-${suffix}@contestos.test`;
      const password = 'password123';
      const name = 'M02 P03 T02 Brand Admin';
      const organizationName = `M02 P03 T02 Org ${suffix}`;
      const slug = `m02p03-t02-${suffix}`.toLowerCase();

      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/brand',
        payload: { email, password, name, organizationName, slug },
      });

      assert.equal(registerRes.statusCode, 201);
      const registerBody = JSON.parse(registerRes.payload);
      assertFrozenEnvelope(registerBody);
      assert.equal(registerBody.success, true);
      assert.equal(registerBody.message, 'Brand organization and admin created successfully');
      assert.equal(registerBody.errors, null);
      assert.equal(registerBody.data.user.email, email);
      assert.equal(registerBody.data.user.name, name);
      assert.equal(registerBody.data.user.role, Role.BRAND_ADMIN);
      assert.equal(typeof registerBody.data.user.organizationId, 'string');
      assert.ok(registerBody.data.user.organizationId);
      assert.equal(registerBody.data.organization.id, registerBody.data.user.organizationId);
      assert.equal(registerBody.data.organization.name, organizationName);
      assert.equal(registerBody.data.organization.slug, slug);
      assert.equal(typeof registerBody.data.token, 'string');
      assert.ok(registerBody.data.token.length > 0);
      assertNoPasswordHash(registerBody);

      const organizationId = registerBody.data.user.organizationId as string;
      createdUserIds.push(registerBody.data.user.id);
      createdOrgIds.push(organizationId);

      const registerClaims = app.jwt.verify<JWTPayload>(registerBody.data.token);
      assert.equal(registerClaims.id, registerBody.data.user.id);
      assert.equal(registerClaims.email, email);
      assert.equal(registerClaims.role, Role.BRAND_ADMIN);
      assert.equal(registerClaims.organizationId, organizationId);

      const persistedOrg = await prisma.organization.findUnique({ where: { id: organizationId } });
      assert.ok(persistedOrg);
      assert.equal(persistedOrg.name, organizationName);
      assert.equal(persistedOrg.slug, slug);

      const persistedUser = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
          organizationId: true,
          passwordHash: true,
        },
      });
      assert.ok(persistedUser);
      assert.equal(persistedUser.role, Role.BRAND_ADMIN);
      assert.equal(persistedUser.organizationId, organizationId);
      assert.ok(persistedUser.passwordHash.startsWith('$2'));
      assert.notEqual(persistedUser.passwordHash, password);

      const duplicateSlugRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/brand',
        payload: {
          email: `other-${email}`,
          password,
          name,
          organizationName: `${organizationName} Other`,
          slug,
        },
      });
      assert.equal(duplicateSlugRes.statusCode, 409);
      const duplicateSlugBody = JSON.parse(duplicateSlugRes.payload);
      assertFrozenEnvelope(duplicateSlugBody);
      assert.equal(duplicateSlugBody.success, false);
      assert.equal(duplicateSlugBody.message, 'Organization with this slug already exists');
      assert.equal(duplicateSlugBody.data, null);

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
      assert.equal(loginBody.data.user.role, Role.BRAND_ADMIN);
      assert.equal(loginBody.data.user.organizationId, organizationId);
      assertNoPasswordHash(loginBody);

      const loginClaims = app.jwt.verify<JWTPayload>(loginBody.data.token);
      assert.equal(loginClaims.role, Role.BRAND_ADMIN);
      assert.equal(loginClaims.organizationId, organizationId);

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
      assert.equal(meBody.data.id, persistedUser.id);
      assert.equal(meBody.data.email, email);
      assert.equal(meBody.data.role, Role.BRAND_ADMIN);
      assert.equal(meBody.data.organizationId, organizationId);
      assert.equal(meBody.data.organization?.id, organizationId);
      assert.equal(meBody.data.organization?.slug, slug);
      assertNoPasswordHash(meBody);
    });
  });
});
