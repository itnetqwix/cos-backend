import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

/**
 * M03-P03-T01: independent expected matrix (not derived from route source).
 *
 * Key M03 APIs only. M04 organization branding and M05 contests are
 * implemented and covered by their own tests. Planned M06–M10 routes stay absent.
 * Fine-grained permission table: NOT SPECIFIED (not invented here).
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const USER_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ALL_ROLES = [
  Role.VIEWER,
  Role.CREATOR,
  Role.BRAND_ADMIN,
  Role.SUPER_ADMIN,
] as const;

type MatrixOutcome = 200 | 401 | 403;

const API_MATRIX: Record<string, Record<'UNAUTH' | Role, MatrixOutcome>> = {
  'GET /api/v1/health': {
    UNAUTH: 200,
    VIEWER: 200,
    CREATOR: 200,
    BRAND_ADMIN: 200,
    SUPER_ADMIN: 200,
  },
  'GET /api/v1/': {
    UNAUTH: 200,
    VIEWER: 200,
    CREATOR: 200,
    BRAND_ADMIN: 200,
    SUPER_ADMIN: 200,
  },
  'GET /api/v1/auth/me': {
    UNAUTH: 401,
    VIEWER: 200,
    CREATOR: 200,
    BRAND_ADMIN: 200,
    SUPER_ADMIN: 200,
  },
  'GET /api/v1/users': {
    UNAUTH: 401,
    VIEWER: 403,
    CREATOR: 403,
    BRAND_ADMIN: 403,
    SUPER_ADMIN: 200,
  },
  [`GET /api/v1/users/${USER_ID}`]: {
    UNAUTH: 401,
    VIEWER: 403,
    CREATOR: 403,
    BRAND_ADMIN: 403,
    SUPER_ADMIN: 200,
  },
};

const PLANNED_ABSENT_PATHS = [
  '/api/v1/admin/moderation/queue',
  '/api/v1/super-admin/organizations',
  '/api/v1/submissions/presign',
  '/api/v1/submissions/me',
] as const;

function assertFrozenErrorEnvelope(
  body: Record<string, unknown>,
  statusMessagePattern: RegExp,
): void {
  assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
  assert.equal(body.success, false);
  assert.equal(typeof body.message, 'string');
  assert.match(String(body.message), statusMessagePattern);
  assert.equal(body.data, null);
  assert.equal(body.errors, null);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  assert.equal(body.error, undefined);
}

function assertFrozenSuccessEnvelope(body: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
  assert.equal(body.success, true);
  assert.equal(body.errors, null);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
}

function mockUser(role: Role) {
  return {
    id: USER_ID,
    email: `${role.toLowerCase()}@contestos.com`,
    name: `${role} User`,
    role,
    organizationId: role === Role.BRAND_ADMIN ? 'org-matrix' : null,
    organization:
      role === Role.BRAND_ADMIN
        ? { id: 'org-matrix', name: 'Matrix Org', slug: 'matrix-org' }
        : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('M03-P03-T01 backend role × API allow/deny matrix', () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  function tokenFor(role: Role): string {
    return app.jwt.sign({
      id: USER_ID,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
      organizationId: role === Role.BRAND_ADMIN ? 'org-matrix' : null,
    });
  }

  async function inject(
    methodUrl: string,
    role: 'UNAUTH' | Role,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const [method, url] = methodUrl.split(' ') as ['GET', string];
    const headers =
      role === 'UNAUTH' ? {} : { authorization: `Bearer ${tokenFor(role)}` };

    const originalFindById = UserRepository.findById;
    const originalFindMany = UserRepository.findMany;

    if (role !== 'UNAUTH') {
      UserRepository.findById = (async () =>
        mockUser(role)) as unknown as typeof UserRepository.findById;
      UserRepository.findMany = (async () => ({
        users: [],
        totalCount: 0,
      })) as unknown as typeof UserRepository.findMany;
    }

    try {
      const res = await app.inject({ method, url, headers });
      return { statusCode: res.statusCode, body: JSON.parse(res.payload) };
    } finally {
      UserRepository.findById = originalFindById;
      UserRepository.findMany = originalFindMany;
    }
  }

  for (const [methodUrl, outcomes] of Object.entries(API_MATRIX)) {
    it(`${methodUrl}: unauthenticated → ${outcomes.UNAUTH}`, async () => {
      const { statusCode, body } = await inject(methodUrl, 'UNAUTH');
      assert.equal(statusCode, outcomes.UNAUTH);
      if (outcomes.UNAUTH === 401) {
        assertFrozenErrorEnvelope(body, /Unauthorized/);
      } else {
        assertFrozenSuccessEnvelope(body);
      }
    });

    for (const role of ALL_ROLES) {
      it(`${methodUrl}: ${role} → ${outcomes[role]}`, async () => {
        const { statusCode, body } = await inject(methodUrl, role);
        assert.equal(statusCode, outcomes[role]);
        if (outcomes[role] === 401) {
          assertFrozenErrorEnvelope(body, /Unauthorized/);
        } else if (outcomes[role] === 403) {
          assertFrozenErrorEnvelope(body, /Forbidden/);
        } else {
          assertFrozenSuccessEnvelope(body);
          if (methodUrl === 'GET /api/v1/auth/me') {
            assert.equal(body.data && (body.data as { role: Role }).role, role);
          }
        }
      });
    }
  }

  it('GET /api/v1/users: invalid Bearer → 401 frozen envelope (not 403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer not.a.valid.token' },
    });
    assert.equal(res.statusCode, 401);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Unauthorized/);
  });

  it('GET /api/v1/auth/me: invalid Bearer → 401 frozen envelope (not 403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not.a.valid.token' },
    });
    assert.equal(res.statusCode, 401);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Unauthorized/);
  });

  it('frontend aliases ORGANIZATION_ADMIN / PLATFORM_ADMIN are not JWT roles', async () => {
    const token = app.jwt.sign({
      id: USER_ID,
      email: 'alias@contestos.com',
      role: 'PLATFORM_ADMIN' as unknown as Role,
      organizationId: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Forbidden/);
  });

  it('registers M05 contest routes and still omits M06–M10 APIs', async () => {
    const routesSrc = readFileSync(path.join(SRC_ROOT, 'routes/index.ts'), 'utf8');
    assert.match(routesSrc, /\/contests/);
    assert.match(routesSrc, /\/organizations\/:slug\/branding/);
    assert.match(routesSrc, /\/organizations\/:id\/branding/);
    assert.doesNotMatch(routesSrc, /\/submissions/);
    assert.doesNotMatch(routesSrc, /\/admin\/moderation/);
    assert.doesNotMatch(routesSrc, /\/super-admin/);

    for (const url of PLANNED_ABSENT_PATHS) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 404, `${url} must not exist yet (M06+ not started)`);
    }
  });

  it('BRAND_ADMIN org-scoped GET /users remains NOT SPECIFIED and is denied', async () => {
    const { statusCode, body } = await inject('GET /api/v1/users', Role.BRAND_ADMIN);
    assert.equal(statusCode, 403);
    assertFrozenErrorEnvelope(body, /Forbidden/);
  });
});
