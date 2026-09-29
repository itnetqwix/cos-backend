import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AuthService } from '../../src/services/auth.service.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../src/utils/response.js';
import { SYSTEM_CONSTANTS } from '../../src/config/constants.js';
import { JWTPayload } from '../../src/types/auth.js';
import { registerCreatorSchema } from '../../src/schemas/auth.schema.js';

const BCRYPT_COST_10 = /^\$2[aby]?\$10\$/;
const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];

function assertJwtClaims(
  decoded: JWTPayload,
  expected: { id: string; email: string; role: Role },
) {
  assert.equal(decoded.id, expected.id);
  assert.equal(decoded.email, expected.email);
  assert.equal(decoded.role, expected.role);
  assert.equal('organizationId' in decoded, false);
}

describe('M02-P01 auth confirmation', () => {
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

  describe('M02-P01-T01 registerCreator: bcrypt hash, User create, JWT claims', () => {
    it('uses bcrypt cost 10 via SYSTEM_CONSTANTS.BCRYPT_SALT_ROUNDS', () => {
      assert.equal(SYSTEM_CONSTANTS.BCRYPT_SALT_ROUNDS, 10);
    });

    it('hashes the password before UserRepository.createCreator and omits passwordHash from the result', async () => {
      let persisted:
        | { email: string; passwordHash: string; name: string }
        | undefined;

      const mockUser = {
        id: 'creator-uuid-t01',
        email: 't01-creator@contestos.com',
        name: 'T01 Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;

      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async (data) => {
        persisted = data;
        return mockUser;
      }) as unknown as typeof UserRepository.createCreator;

      try {
        const result = await AuthService.registerCreator(
          {
            email: 't01-creator@contestos.com',
            password: 'password123',
            name: 'T01 Creator',
          },
          app,
        );

        assert.ok(persisted, 'createCreator must be called (User create)');
        assert.equal(persisted.email, 't01-creator@contestos.com');
        assert.equal(persisted.name, 'T01 Creator');
        assert.notEqual(persisted.passwordHash, 'password123');
        assert.match(persisted.passwordHash, BCRYPT_COST_10);
        assert.equal(await bcrypt.compare('password123', persisted.passwordHash), true);
        assert.equal(await bcrypt.compare('wrong-password', persisted.passwordHash), false);

        assert.equal(result.user.id, mockUser.id);
        assert.equal(result.user.role, Role.CREATOR);
        assert.equal((result.user as Record<string, unknown>).passwordHash, undefined);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('signs JWT with claims id, email, and role', async () => {
      const mockUser = {
        id: 'creator-jwt-t01',
        email: 't01-jwt@contestos.com',
        name: 'JWT Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;

      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async () =>
        mockUser) as unknown as typeof UserRepository.createCreator;

      try {
        const result = await AuthService.registerCreator(
          {
            email: 't01-jwt@contestos.com',
            password: 'password123',
            name: 'JWT Creator',
          },
          app,
        );

        const decoded = app.jwt.verify<JWTPayload>(result.token);
        assertJwtClaims(decoded, {
          id: mockUser.id,
          email: mockUser.email,
          role: Role.CREATOR,
        });
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('throws ConflictError when email already exists (does not create)', async () => {
      let createCalled = false;
      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;

      UserRepository.findByEmail = (async () => ({
        id: 'existing',
        email: 'taken@contestos.com',
      })) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async () => {
        createCalled = true;
        throw new Error('createCreator must not run on email conflict');
      }) as unknown as typeof UserRepository.createCreator;

      try {
        await assert.rejects(
          () =>
            AuthService.registerCreator(
              {
                email: 'taken@contestos.com',
                password: 'password123',
                name: 'Taken User',
              },
              app,
            ),
          (err: unknown) => {
            assert.ok(err instanceof ConflictError);
            assert.equal(err.statusCode, 409);
            assert.equal(err.message, 'User with this email already exists');
            return true;
          },
        );
        assert.equal(createCalled, false);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('POST /api/v1/auth/register/creator returns 201 envelope, token claims, and no passwordHash', async () => {
      const mockUser = {
        id: 'creator-http-t01',
        email: 't01-http@contestos.com',
        name: 'HTTP Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;
      let persistedHash: string | undefined;

      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async (data) => {
        persistedHash = data.passwordHash;
        return mockUser;
      }) as unknown as typeof UserRepository.createCreator;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register/creator',
          payload: {
            email: 't01-http@contestos.com',
            password: 'password123',
            name: 'HTTP Creator',
          },
        });

        assert.equal(res.statusCode, 201);
        const body = JSON.parse(res.payload);
        assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
        assert.equal(body.success, true);
        assert.equal(body.message, 'Creator account created successfully');
        assert.equal(body.errors, null);
        assert.equal(body.data.user.email, 't01-http@contestos.com');
        assert.equal(body.data.user.role, Role.CREATOR);
        assert.equal(body.data.user.passwordHash, undefined);
        assert.ok(body.data.token);
        assert.ok(persistedHash);
        assert.match(persistedHash, BCRYPT_COST_10);

        const decoded = app.jwt.verify<JWTPayload>(body.data.token);
        assertJwtClaims(decoded, {
          id: mockUser.id,
          email: mockUser.email,
          role: Role.CREATOR,
        });
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('POST /api/v1/auth/register/creator returns 409 for duplicate email', async () => {
      const originalFindByEmail = UserRepository.findByEmail;
      UserRepository.findByEmail = (async () => ({
        id: 'existing',
        email: 'dup@contestos.com',
      })) as unknown as typeof UserRepository.findByEmail;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register/creator',
          payload: {
            email: 'dup@contestos.com',
            password: 'password123',
            name: 'Dup User',
          },
        });

        assert.equal(res.statusCode, 409);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
        assert.equal(body.message, 'User with this email already exists');
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('Zod registerCreator contract is email, password, name only (no handle)', () => {
      const parsed = registerCreatorSchema.parse({
        email: 'Schema@Contestos.com',
        password: 'password123',
        name: 'Schema User',
        handle: 'should-be-stripped',
      });
      assert.deepEqual(Object.keys(parsed).sort(), ['email', 'name', 'password']);
      assert.equal(parsed.email, 'schema@contestos.com');
      assert.equal('handle' in parsed, false);
    });
  });

  describe('M02-P01-T03 login: password compare, sanitized user, token', () => {
    async function withLoginUser(
      overrides: Partial<{
        id: string;
        email: string;
        name: string;
        passwordHash: string;
        role: Role;
      }> = {},
    ) {
      const passwordHash = await bcrypt.hash('password123', 10);
      const mockUser = {
        id: 'login-user-t03',
        email: 't03-login@contestos.com',
        name: 'Login User',
        passwordHash,
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };

      const originalFindByEmail = UserRepository.findByEmail;
      UserRepository.findByEmail = (async () =>
        mockUser) as unknown as typeof UserRepository.findByEmail;
      return { mockUser, originalFindByEmail };
    }

    it('compares bcrypt hash, returns sanitized user, and signs JWT claims', async () => {
      const { mockUser, originalFindByEmail } = await withLoginUser();
      try {
        const result = await AuthService.login(
          { email: 't03-login@contestos.com', password: 'password123' },
          app,
        );

        assert.equal(result.user.email, mockUser.email);
        assert.equal(result.user.name, mockUser.name);
        assert.equal(result.user.role, Role.CREATOR);
        assert.equal((result.user as Record<string, unknown>).passwordHash, undefined);
        assert.equal('passwordHash' in result.user, false);

        const decoded = app.jwt.verify<JWTPayload>(result.token);
        assertJwtClaims(decoded, {
          id: mockUser.id,
          email: mockUser.email,
          role: Role.CREATOR,
        });
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('throws UnauthorizedError for unknown email without revealing which field failed', async () => {
      const originalFindByEmail = UserRepository.findByEmail;
      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      try {
        await assert.rejects(
          () =>
            AuthService.login(
              { email: 'missing@contestos.com', password: 'password123' },
              app,
            ),
          (err: unknown) => {
            assert.ok(err instanceof UnauthorizedError);
            assert.equal(err.statusCode, 401);
            assert.equal(err.message, 'Invalid email or password');
            return true;
          },
        );
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('throws UnauthorizedError when bcrypt compare fails', async () => {
      const { originalFindByEmail } = await withLoginUser();
      try {
        await assert.rejects(
          () =>
            AuthService.login(
              { email: 't03-login@contestos.com', password: 'wrong-password' },
              app,
            ),
          (err: unknown) => {
            assert.ok(err instanceof UnauthorizedError);
            assert.equal(err.statusCode, 401);
            assert.equal(err.message, 'Invalid email or password');
            return true;
          },
        );
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('POST /api/v1/auth/login returns 200 sanitized user + token with JWT claims', async () => {
      const { mockUser, originalFindByEmail } = await withLoginUser({
        id: 'login-http-t03',
        email: 't03-http@contestos.com',
      });
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 't03-http@contestos.com', password: 'password123' },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.payload);
        assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
        assert.equal(body.success, true);
        assert.equal(body.message, 'Login successful');
        assert.equal(body.errors, null);
        assert.equal(body.data.user.email, 't03-http@contestos.com');
        assert.equal(body.data.user.passwordHash, undefined);
        assert.ok(body.data.token);

        const decoded = app.jwt.verify<JWTPayload>(body.data.token);
        assertJwtClaims(decoded, {
          id: mockUser.id,
          email: mockUser.email,
          role: Role.CREATOR,
        });
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('POST /api/v1/auth/login returns 401 for wrong password', async () => {
      const { originalFindByEmail } = await withLoginUser();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 't03-login@contestos.com', password: 'wrong-password' },
        });

        assert.equal(res.statusCode, 401);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
        assert.equal(body.message, 'Invalid email or password');
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });

    it('POST /api/v1/auth/login returns 401 for unknown email', async () => {
      const originalFindByEmail = UserRepository.findByEmail;
      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'nobody@contestos.com', password: 'password123' },
        });

        assert.equal(res.statusCode, 401);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
        assert.equal(body.message, 'Invalid email or password');
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });
  });

  describe('M02-P01-T04 GET /auth/me: authenticate required, current user returned', () => {
    it('route source registers fastify.authenticate on GET /auth/me', () => {
      const routesPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../src/routes/index.ts',
      );
      const src = readFileSync(routesPath, 'utf8');
      assert.match(src, /['"]\/auth\/me['"]/);
      assert.match(src, /onRequest:\s*\[fastify\.authenticate\]/);
    });

    it('findById select omits passwordHash', () => {
      const repoPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../src/repositories/user.repository.ts',
      );
      const src = readFileSync(repoPath, 'utf8');
      assert.match(src, /static async findById/);
      assert.doesNotMatch(
        src.slice(src.indexOf('static async findById'), src.indexOf('static async createCreator')),
        /passwordHash/,
      );
    });

    it('GET /api/v1/auth/me returns 401 without a Bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload);
      assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.match(body.message, /Unauthorized/);
    });

    it('GET /api/v1/auth/me returns 401 for an invalid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer not.a.valid.token' },
      });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.match(body.message, /Unauthorized/);
    });

    it('GET /api/v1/auth/me returns 200 current user for the JWT id and omits passwordHash', async () => {
      const mockUser = {
        id: 'me-user-t04',
        email: 't04-me@contestos.com',
        name: 'Me User',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const token = app.jwt.sign({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });

      let requestedId: string | undefined;
      const originalFindById = UserRepository.findById;
      UserRepository.findById = (async (id: string) => {
        requestedId = id;
        return mockUser;
      }) as unknown as typeof UserRepository.findById;

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(requestedId, mockUser.id);
        const body = JSON.parse(res.payload);
        assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
        assert.equal(body.success, true);
        assert.equal(body.message, 'User profile retrieved successfully');
        assert.equal(body.data.id, mockUser.id);
        assert.equal(body.data.email, mockUser.email);
        assert.equal(body.data.passwordHash, undefined);
      } finally {
        UserRepository.findById = originalFindById;
      }
    });

    it('GET /api/v1/auth/me returns 404 when the JWT user no longer exists', async () => {
      const token = app.jwt.sign({
        id: 'deleted-user-t04',
        email: 'gone@contestos.com',
        role: Role.CREATOR,
      });

      const originalFindById = UserRepository.findById;
      UserRepository.findById = (async () =>
        null) as unknown as typeof UserRepository.findById;

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(res.statusCode, 404);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
        assert.equal(body.message, 'User profile not found');
      } finally {
        UserRepository.findById = originalFindById;
      }
    });

    it('AuthService.getCurrentUser throws NotFoundError when profile is missing', async () => {
      const originalFindById = UserRepository.findById;
      UserRepository.findById = (async () =>
        null) as unknown as typeof UserRepository.findById;
      try {
        await assert.rejects(
          () => AuthService.getCurrentUser('missing-id'),
          (err: unknown) => err instanceof NotFoundError && err.statusCode === 404,
        );
      } finally {
        UserRepository.findById = originalFindById;
      }
    });
  });

  describe('M02-P01-T05 User.handle / avatarUrl persistence gap', () => {
    it('Prisma User model has no handle or avatarUrl columns', () => {
      const schemaPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../prisma/schema.prisma',
      );
      const src = readFileSync(schemaPath, 'utf8');
      const userBlock = src.slice(src.indexOf('model User'), src.indexOf('@@map("users")'));
      assert.match(userBlock, /email\s+String\s+@unique/);
      assert.doesNotMatch(userBlock, /^\s+handle\s+/m);
      assert.doesNotMatch(userBlock, /^\s+avatarUrl\s+/m);
    });

    it('JWTPayload source claims are only id, email, role', () => {
      const typePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../src/types/auth.ts',
      );
      const src = readFileSync(typePath, 'utf8');
      const block = src.slice(src.indexOf('export interface JWTPayload'), src.indexOf('export interface AuthTokens'));
      assert.match(block, /id:\s*string/);
      assert.match(block, /email:\s*string/);
      assert.match(block, /role:\s*Role/);
      assert.doesNotMatch(block, /organizationId/);
      assert.doesNotMatch(block, /^\s+handle:/m);
      assert.doesNotMatch(block, /^\s+avatarUrl:/m);
    });

    it('SanitizedUser source has no handle or avatarUrl', () => {
      const typePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../src/types/user.ts',
      );
      const src = readFileSync(typePath, 'utf8');
      const block = src.slice(
        src.indexOf('export interface SanitizedUser'),
        src.indexOf('export interface UserPaginationQuery'),
      );
      assert.doesNotMatch(block, /^\s+handle:/m);
      assert.doesNotMatch(block, /^\s+avatarUrl:/m);
    });
  });

  describe('M02-P01-T06 handle dropped from API contract', () => {
    it('OpenAPI register/creator body properties are email, password, name only', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs/json' });
      assert.equal(res.statusCode, 200);
      const spec = JSON.parse(res.payload);
      const body =
        spec.paths['/api/v1/auth/register/creator'].post.requestBody.content['application/json']
          .schema;
      const keys = Object.keys(body.properties).sort();
      assert.deepEqual(keys, ['email', 'name', 'password']);
      assert.equal('handle' in body.properties, false);
      assert.equal('avatarUrl' in body.properties, false);
      assert.deepEqual([...body.required].sort(), ['email', 'name', 'password']);
    });

    it('POST /auth/register/creator ignores extra handle and does not persist it', async () => {
      let persisted: { email: string; passwordHash: string; name: string } | undefined;
      const mockUser = {
        id: 'creator-t06',
        email: 't06-creator@contestos.com',
        name: 'T06 Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;
      UserRepository.findByEmail = (async () =>
        null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async (data) => {
        persisted = data;
        return mockUser;
      }) as unknown as typeof UserRepository.createCreator;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register/creator',
          payload: {
            email: 't06-creator@contestos.com',
            password: 'password123',
            name: 'T06 Creator',
            handle: 't06handle',
            avatarUrl: 'https://example.com/a.png',
          },
        });

        assert.equal(res.statusCode, 201);
        const body = JSON.parse(res.payload);
        assert.equal(body.data.user.email, 't06-creator@contestos.com');
        assert.equal(body.data.user.handle, undefined);
        assert.equal(body.data.user.avatarUrl, undefined);
        assert.ok(persisted);
        assert.deepEqual(Object.keys(persisted).sort(), ['email', 'name', 'passwordHash']);
        assert.equal('handle' in persisted, false);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });
  });
});
