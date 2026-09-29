import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { AuthService } from '../../src/services/auth.service.js';
import { registerCreatorSchema, loginSchema } from '../../src/schemas/auth.schema.js';
import { JWTPayload } from '../../src/types/auth.js';

describe('Contest Operating System (COS) - Auth & Multi-Role Registration Module', () => {
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

  describe('1. Global Response Envelope & Base Endpoints', () => {
    it('GET /api/v1/health returns 200 with standard success response envelope', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
      assert.equal(typeof body.message, 'string');
      assert.equal(body.errors, null);
      assert.equal(body.data.status, 'healthy');
      assert.ok(body.data.timestamp);
    });

    it('GET /api/v1 returns 200 with standard success response envelope', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1',
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
      assert.equal(body.errors, null);
      assert.equal(body.data.name, 'Contest Operating System Backend');
      assert.equal(body.data.version, '1.0.0');
    });
  });

  describe('2. Schema Validation Rules (Zod)', () => {
    it('validates registerCreator input correctly', () => {
      const valid = registerCreatorSchema.parse({
        email: 'CREATOR@test.com',
        password: 'password123',
        name: 'Creator One',
      });
      assert.equal(valid.email, 'creator@test.com');
      assert.equal(valid.name, 'Creator One');

      assert.throws(() => {
        registerCreatorSchema.parse({
          email: 'creator@test.com',
          password: '123',
          name: 'Creator One',
        });
      });

      assert.throws(() => {
        registerCreatorSchema.parse({
          email: 'creator@test.com',
          password: 'password123',
          name: 'A',
        });
      });
    });

    it('validates login input correctly', () => {
      const valid = loginSchema.parse({
        email: 'USER@TEST.COM',
        password: 'password123',
      });
      assert.equal(valid.email, 'user@test.com');

      assert.throws(() => {
        loginSchema.parse({
          email: 'invalid-email',
          password: '',
        });
      });
    });
  });

  describe('3. Password Hashing & JWT Token Generation', () => {
    it('hashes passwords using bcrypt with 10 salt rounds', async () => {
      const password = 'mySecretPassword123';
      const hash = await bcrypt.hash(password, 10);

      assert.ok(hash.startsWith('$2'));
      const isMatch = await bcrypt.compare(password, hash);
      assert.equal(isMatch, true);

      const isMismatch = await bcrypt.compare('wrongPassword', hash);
      assert.equal(isMismatch, false);
    });

    it('signs and verifies JWT with custom user payload', async () => {
      const payload: JWTPayload = {
        id: 'user-uuid-1234',
        email: 'creator@contestos.com',
        role: Role.CREATOR,
      };

      const token = app.jwt.sign(payload);
      assert.equal(typeof token, 'string');

      const decoded = app.jwt.verify<JWTPayload>(token);
      assert.equal(decoded.id, payload.id);
      assert.equal(decoded.email, payload.email);
      assert.equal(decoded.role, Role.CREATOR);
      assert.equal('organizationId' in decoded, false);
    });
  });

  describe('4. Fastify Authentication Decorator & Guarded Routes', () => {
    it('GET /api/v1/auth/me fails with 401 when Bearer token is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.match(body.message, /Unauthorized/);
    });

    it('GET /api/v1/auth/me fails with 401 when Bearer token is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer invalid.token.payload',
        },
      });

      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.match(body.message, /Unauthorized/);
    });
  });

  describe('5. Auth Business Logic & Controller Handlers', () => {
    it('AuthService.registerCreator creates creator user and returns sanitized payload and JWT', async () => {
      const mockUser = {
        id: 'c-uuid-1',
        email: 'mockcreator@contestos.com',
        name: 'Mock Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;

      UserRepository.findByEmail = (async () => null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async () => mockUser) as unknown as typeof UserRepository.createCreator;

      try {
        const result = await AuthService.registerCreator(
          {
            email: 'mockcreator@contestos.com',
            password: 'password123',
            name: 'Mock Creator',
          },
          app,
        );

        assert.equal(result.user.email, 'mockcreator@contestos.com');
        assert.equal(result.user.role, Role.CREATOR);
        assert.ok(result.token);
        assert.equal((result.user as Record<string, unknown>).passwordHash, undefined);

        const decoded = app.jwt.verify<{ id: string; email: string; role: string }>(result.token);
        assert.equal(decoded.id, mockUser.id);
        assert.equal(decoded.email, mockUser.email);
        assert.equal(decoded.role, Role.CREATOR);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('AuthService.login authenticates user and verifies password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = {
        id: 'u-uuid-10',
        email: 'login@test.com',
        name: 'Login User',
        passwordHash: hashedPassword,
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      UserRepository.findByEmail = (async () => mockUser) as unknown as typeof UserRepository.findByEmail;

      try {
        const result = await AuthService.login(
          {
            email: 'login@test.com',
            password: 'password123',
          },
          app,
        );

        assert.equal(result.user.email, 'login@test.com');
        assert.ok(result.token);
        assert.equal((result.user as Record<string, unknown>).passwordHash, undefined);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
      }
    });
  });

  describe('6. End-to-End Route Invocations with Mocked Data', () => {
    it('POST /api/v1/auth/register/creator returns 201 with success envelope', async () => {
      const mockUser = {
        id: 'creator-1',
        email: 'e2ecreator@test.com',
        name: 'E2E Creator',
        role: Role.CREATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const originalFindByEmail = UserRepository.findByEmail;
      const originalCreateCreator = UserRepository.createCreator;

      UserRepository.findByEmail = (async () => null) as unknown as typeof UserRepository.findByEmail;
      UserRepository.createCreator = (async () => mockUser) as unknown as typeof UserRepository.createCreator;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register/creator',
          payload: {
            email: 'e2ecreator@test.com',
            password: 'password123',
            name: 'E2E Creator',
          },
        });

        assert.equal(res.statusCode, 201);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, true);
        assert.equal(body.message, 'Creator account created successfully');
        assert.equal(body.data.user.email, 'e2ecreator@test.com');
        assert.ok(body.data.token);
      } finally {
        UserRepository.findByEmail = originalFindByEmail;
        UserRepository.createCreator = originalCreateCreator;
      }
    });

    it('POST /api/v1/auth/register/brand is not registered', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/brand',
        payload: {
          email: 'admin@brandorg.com',
          password: 'password123',
          name: 'Brand Admin',
          organizationName: 'Brand Org',
          slug: 'brand-org',
        },
      });
      assert.equal(res.statusCode, 404);
    });

    it('GET /api/v1/auth/me with valid Bearer token returns 200 with profile', async () => {
      const mockUser = {
        id: 'me-user-1',
        email: 'me@contestos.com',
        name: 'Authenticated User',
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
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, true);
        assert.equal(body.data.email, 'me@contestos.com');
        assert.equal(body.data.name, 'Authenticated User');
      } finally {
        UserRepository.findById = originalFindById;
      }
    });
  });

  describe('7. Interactive OpenAPI 3.0 Documentation (Swagger)', () => {
    it('GET /docs loads Swagger UI HTML documentation page', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/',
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'));
      assert.ok(res.payload.includes('swagger-ui'));
    });

    it('GET /docs/json returns OpenAPI 3.0 specification JSON with Security Schemes and Auth routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      assert.equal(res.statusCode, 200);
      const spec = JSON.parse(res.payload);
      assert.equal(spec.openapi, '3.0.3');
      assert.equal(spec.info.title, 'Contest Operating System Backend');
      assert.equal(spec.info.version, '1.0.0');

      // Verify Security Schemes
      assert.ok(spec.components?.securitySchemes?.bearerAuth);
      assert.equal(spec.components.securitySchemes.bearerAuth.type, 'http');
      assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
      assert.equal(spec.components.securitySchemes.bearerAuth.bearerFormat, 'JWT');

      // Verify Routes in OpenAPI Specification
      assert.ok(spec.paths['/api/v1/auth/register/creator']?.post);
      assert.equal(spec.paths['/api/v1/auth/register/brand'], undefined);
      assert.ok(spec.paths['/api/v1/contests/active']?.get);
      assert.ok(spec.paths['/api/v1/auth/login']?.post);
      assert.ok(spec.paths['/api/v1/auth/me']?.get);
      assert.ok(spec.paths['/api/v1/users']?.get);
      assert.ok(spec.paths['/api/v1/users/{id}']?.get);

      // Verify each route only appears once
      const paths = Object.keys(spec.paths);
      const creatorPaths = paths.filter((p) => p.endsWith('/auth/register/creator'));
      assert.equal(creatorPaths.length, 1, 'Route /auth/register/creator should only appear once in Swagger');

      // Verify Protected Route Security
      const meRoute = spec.paths['/api/v1/auth/me'].get;
      assert.ok(Array.isArray(meRoute.security));
      assert.deepEqual(meRoute.security, [{ bearerAuth: [] }]);
    });
  });
});
