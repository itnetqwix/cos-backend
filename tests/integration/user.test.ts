import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

describe('Contest Operating System (COS) - User Management & Querying Module', () => {
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

  describe('1. GET /api/v1/users', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
      });

      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, false);
    });

    it('returns 200 with paginated user collection when authenticated', async () => {
      const mockUsers = [
        {
          id: 'u-1',
          email: 'admin@test.com',
          name: 'Admin User',
          role: Role.SUPER_ADMIN,
          organizationId: null,
          organization: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'u-2',
          email: 'creator@test.com',
          name: 'Creator User',
          role: Role.CREATOR,
          organizationId: null,
          organization: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const token = app.jwt.sign({
        id: 'u-1',
        email: 'admin@test.com',
        role: Role.SUPER_ADMIN,
        organizationId: null,
      });

      const originalFindMany = UserRepository.findMany;
      UserRepository.findMany = (async () => ({
        users: mockUsers,
        totalCount: 2,
      })) as unknown as typeof UserRepository.findMany;

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/users?page=1&limit=10',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, true);
        assert.equal(body.data.items.length, 2);
        assert.equal(body.data.pagination.totalCount, 2);
        assert.equal(body.data.pagination.currentPage, 1);
      } finally {
        UserRepository.findMany = originalFindMany;
      }
    });
  });

  describe('2. GET /api/v1/users/:id', () => {
    it('returns 200 with user profile when user exists', async () => {
      const mockUser = {
        id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        email: 'creator@test.com',
        name: 'Creator User',
        role: Role.CREATOR,
        organizationId: null,
        organization: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const token = app.jwt.sign({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        organizationId: null,
      });

      const originalFindById = UserRepository.findById;
      UserRepository.findById = (async () => mockUser) as unknown as typeof UserRepository.findById;

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/users/${mockUser.id}`,
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, true);
        assert.equal(body.data.id, mockUser.id);
        assert.equal(body.data.email, mockUser.email);
      } finally {
        UserRepository.findById = originalFindById;
      }
    });

    it('returns 404 when user is not found', async () => {
      const token = app.jwt.sign({
        id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        email: 'admin@test.com',
        role: Role.SUPER_ADMIN,
        organizationId: null,
      });

      const originalFindById = UserRepository.findById;
      UserRepository.findById = (async () => null) as unknown as typeof UserRepository.findById;

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/users/a0000000-0000-4000-8000-000000000000',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        assert.equal(res.statusCode, 404);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
      } finally {
        UserRepository.findById = originalFindById;
      }
    });
  });
});
