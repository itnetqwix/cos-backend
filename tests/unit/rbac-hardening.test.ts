import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { JWTPayload } from '../../src/types/auth.js';
import { authorizeRoles, requireRoles } from '../../src/middleware/auth.middleware.js';
import { ROLES } from '../../src/config/constants.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const JWT_CLAIM_KEYS = ['id', 'email', 'role'] as const;
const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function readSrc(relativePath: string): string {
  return readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('M03-P01-T01 authenticate + authorizeRoles + JWT payload typing', () => {
  it('JWTPayload documents exactly id, email, role', () => {
    const src = readSrc('types/auth.ts');
    const block = src.slice(src.indexOf('export interface JWTPayload'), src.indexOf('export interface AuthTokens'));
    assert.match(block, /id:\s*string/);
    assert.match(block, /email:\s*string/);
    assert.match(block, /role:\s*Role/);
    assert.doesNotMatch(block, /organizationId/);
    assert.doesNotMatch(block, /handle/);
    assert.doesNotMatch(block, /avatarUrl/);
  });

  it('FastifyJWT payload and user are typed as JWTPayload', () => {
    const src = readSrc('types/fastify.d.ts');
    assert.match(src, /interface FastifyJWT/);
    assert.match(src, /payload:\s*JWTPayload/);
    assert.match(src, /user:\s*JWTPayload/);
    assert.match(src, /interface FastifyRequest[\s\S]*user:\s*JWTPayload/);
  });

  it('jwt plugin decorates fastify.authenticate with middleware authenticate', () => {
    const jwtSrc = readSrc('plugins/jwt.ts');
    assert.match(jwtSrc, /from '\.\.\/middleware\/auth\.middleware\.js'/);
    assert.match(jwtSrc, /fastify\.decorate\(\s*['"]authenticate['"]\s*,\s*authenticate\s*\)/);
    assert.doesNotMatch(jwtSrc, /request\.jwtVerify/);
  });

  it('middleware exports authorizeRoles as the canonical Role guard', () => {
    const src = readSrc('middleware/auth.middleware.ts');
    assert.match(src, /export async function authenticate/);
    assert.match(src, /export function authorizeRoles\(\.\.\.allowedRoles:\s*Role\[\]\)/);
    assert.match(src, /export const requireRoles = authorizeRoles/);
    assert.match(src, /HTTP_STATUS\.FORBIDDEN/);
    assert.match(src, /sendError/);
  });

  it('ROLES constants match the Prisma Role enum used in JWT claims', () => {
    assert.equal(ROLES.ADMIN, Role.ADMIN);
    assert.equal(ROLES.CREATOR, Role.CREATOR);
    assert.equal(typeof authorizeRoles, 'function');
    assert.equal(requireRoles, authorizeRoles);
  });

  it('GET /auth/me still uses fastify.authenticate without a role guard', () => {
    const src = readSrc('routes/index.ts');
    const meBlock = src.slice(src.indexOf("'/auth/me'"), src.indexOf("'/users'"));
    assert.match(meBlock, /onRequest:\s*\[fastify\.authenticate\]/);
    assert.doesNotMatch(meBlock, /authorizeRoles/);
  });
});

describe('M03-P01-T01 runtime JWT verify + authenticate (no role restriction on /auth/me)', () => {
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

  it('jwt.sign/verify round-trip preserves exactly the four access-token claims', async () => {
    const payload: JWTPayload = {
      id: 'jwt-t01-user',
      email: 't01-jwt@contestos.com',
      role: Role.CREATOR,
    };

    const token = app.jwt.sign(payload);
    const decoded = app.jwt.verify<JWTPayload>(token);

    for (const key of JWT_CLAIM_KEYS) {
      assert.equal(decoded[key], payload[key]);
    }
    assert.equal((decoded as Record<string, unknown>).handle, undefined);
    assert.equal((decoded as Record<string, unknown>).passwordHash, undefined);
  });

  it('GET /api/v1/auth/me returns 401 frozen envelope without Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(body.errors, null);
    assert.match(body.message, /Unauthorized/);
  });

  it('GET /api/v1/auth/me allows any authenticated Role (CREATOR) — authenticate is not a role check', async () => {
    const mockUser = {
      id: 't01-me-creator',
      email: 't01-me@contestos.com',
      name: 'T01 Me',
      role: Role.CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const token = app.jwt.sign({
      id: mockUser.id,
      email: mockUser.email,
      role: mockUser.role,
    });

    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async () => mockUser) as unknown as typeof UserRepository.findById;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
      assert.equal(body.success, true);
      assert.equal(body.data.id, mockUser.id);
      assert.equal(body.data.role, Role.CREATOR);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });
});

describe('M03-P01-T02 GET /users* restricted to ADMIN', () => {
  it('registers authorizeRoles(Role.ADMIN) on GET /users and GET /users/:id', () => {
    const src = readSrc('routes/index.ts');
    assert.match(
      src,
      /['"]\/users['"][\s\S]*onRequest:\s*\[fastify\.authenticate,\s*authorizeRoles\(Role\.ADMIN\)\]/,
    );
    assert.match(
      src,
      /['"]\/users\/:id['"][\s\S]*onRequest:\s*\[fastify\.authenticate,\s*authorizeRoles\(Role\.ADMIN\)\]/,
    );
  });
});

describe('M03-P01-T02 runtime ADMIN allow / other roles deny', () => {
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
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      email: `${role.toLowerCase()}@contestos.com`,
      role,
    });
  }

  it('GET /api/v1/users returns 200 for ADMIN', async () => {
    const originalFindMany = UserRepository.findMany;
    UserRepository.findMany = (async () => ({
      users: [],
      totalCount: 0,
    })) as unknown as typeof UserRepository.findMany;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${tokenFor(Role.ADMIN)}` },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
    } finally {
      UserRepository.findMany = originalFindMany;
    }
  });

  it('GET /api/v1/users returns 403 for CREATOR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: {
        authorization: `Bearer ${tokenFor(Role.CREATOR)}`,
      },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.match(body.message, /Forbidden/);
  });

  it('GET /api/v1/users/:id returns 403 for CREATOR (self-profile is GET /auth/me)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      headers: { authorization: `Bearer ${tokenFor(Role.CREATOR)}` },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });
});

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

describe('M03-P01-T03 403 body uses the standard error envelope', () => {
  it('authorizeRoles sends 403 through sendError with explicit errors: null', () => {
    const src = readSrc('middleware/auth.middleware.ts');
    const fn = src.slice(src.indexOf('export function authorizeRoles'), src.indexOf('export const requireRoles'));
    assert.match(fn, /sendError\(/);
    assert.match(fn, /HTTP_STATUS\.FORBIDDEN/);
    assert.match(fn, /HTTP_STATUS\.FORBIDDEN,\s*null,/);
    assert.doesNotMatch(fn, /timestamp/);
    assert.doesNotMatch(fn, /error:\s*\{\s*code/);
  });

  it('list and get-by-id Swagger 403 schemas use the frozen error envelope fields', () => {
    const src = readSrc('schemas/user.schema.ts');
    assert.match(src, /listUsersSwaggerSchema[\s\S]*403:[\s\S]*swaggerErrorEnvelope/);
    assert.match(src, /getUserByIdSwaggerSchema[\s\S]*403:[\s\S]*swaggerErrorEnvelope/);
  });
});

describe('M03-P01-T03 runtime 403 envelope on GET /users*', () => {
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

  it('GET /api/v1/users as CREATOR returns 403 frozen envelope', async () => {
    const token = app.jwt.sign({
      id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      email: 'creator-t03@contestos.com',
      role: Role.CREATOR,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 403);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Forbidden/);
  });

  it('GET /api/v1/users/:id as CREATOR returns 403 frozen envelope', async () => {
    const token = app.jwt.sign({
      id: 'cccccccc-dddd-4eee-8fff-000000000000',
      email: 'creator-t03b@contestos.com',
      role: Role.CREATOR,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 403);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Forbidden/);
  });
});

const PROTECTED_USER_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

describe('M03-P01-T04 role allow/deny matrix on GET /users*', () => {
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
      id: PROTECTED_USER_ID,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
    });
  }

  const deniedRoles = [Role.CREATOR] as const;

  it('GET /api/v1/users: missing Bearer → 401 frozen envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    assert.equal(res.statusCode, 401);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Unauthorized/);
  });

  it('GET /api/v1/users: invalid Bearer → 401 frozen envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer not.a.valid.token' },
    });
    assert.equal(res.statusCode, 401);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Unauthorized/);
  });

  it('GET /api/v1/users: ADMIN allowed (200)', async () => {
    const originalFindMany = UserRepository.findMany;
    UserRepository.findMany = (async () => ({
      users: [],
      totalCount: 0,
    })) as unknown as typeof UserRepository.findMany;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${tokenFor(Role.ADMIN)}` },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
      assert.equal(body.success, true);
      assert.equal(body.errors, null);
    } finally {
      UserRepository.findMany = originalFindMany;
    }
  });

  for (const role of deniedRoles) {
    it(`GET /api/v1/users: ${role} denied (403)`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${tokenFor(role)}` },
      });
      assert.equal(res.statusCode, 403);
      assertFrozenErrorEnvelope(JSON.parse(res.payload), /Forbidden/);
    });
  }

  it('GET /api/v1/users/:id: missing Bearer → 401 frozen envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${PROTECTED_USER_ID}`,
    });
    assert.equal(res.statusCode, 401);
    assertFrozenErrorEnvelope(JSON.parse(res.payload), /Unauthorized/);
  });

  it('GET /api/v1/users/:id: ADMIN allowed (200)', async () => {
    const mockUser = {
      id: PROTECTED_USER_ID,
      email: 'listed@contestos.com',
      name: 'Listed User',
      role: Role.CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async () => mockUser) as unknown as typeof UserRepository.findById;

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${PROTECTED_USER_ID}`,
        headers: { authorization: `Bearer ${tokenFor(Role.ADMIN)}` },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
      assert.equal(body.data.id, PROTECTED_USER_ID);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });

  for (const role of deniedRoles) {
    it(`GET /api/v1/users/:id: ${role} denied (403)`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${PROTECTED_USER_ID}`,
        headers: { authorization: `Bearer ${tokenFor(role)}` },
      });
      assert.equal(res.statusCode, 403);
      assertFrozenErrorEnvelope(JSON.parse(res.payload), /Forbidden/);
    });
  }

  it('GET /api/v1/auth/me remains allowed for CREATOR (not the users* guard)', async () => {
    const mockUser = {
      id: PROTECTED_USER_ID,
      email: 'creator@contestos.com',
      name: 'Creator',
      role: Role.CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async () => mockUser) as unknown as typeof UserRepository.findById;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tokenFor(Role.CREATOR)}` },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
      assert.equal(body.data.role, Role.CREATOR);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });
});
