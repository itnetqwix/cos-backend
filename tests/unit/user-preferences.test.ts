import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { UserRepository, inMemoryUserPreferences } from '../../src/repositories/user.repository.js';
import { UserService } from '../../src/services/user.service.js';

describe('User Preferences & Pledge Intro Persistence', () => {
  let app: FastifyInstance;
  let userToken: string;
  let otherUserToken: string;

  const mockUser1 = {
    id: 'f87a8b41-e129-4d69-b5bf-409b3623d6a1',
    email: 'viewer1@ripskis.com',
    name: 'Viewer One',
    role: Role.CREATOR,
    accountStatus: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser2 = {
    id: 'b22c7a33-d912-4e55-8aa4-998877665544',
    email: 'viewer2@ripskis.com',
    name: 'Viewer Two',
    role: Role.CREATOR,
    accountStatus: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();

    userToken = app.jwt.sign({
      id: mockUser1.id,
      email: mockUser1.email,
      role: mockUser1.role,
    });

    otherUserToken = app.jwt.sign({
      id: mockUser2.id,
      email: mockUser2.email,
      role: mockUser2.role,
    });
  });

  after(async () => {
    await app.close();
  });

  it('1. returns 401 when fetching preferences unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/preferences',
    });
    assert.equal(res.statusCode, 401);
  });

  it('2. returns 401 when updating preferences unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/preferences',
      payload: { pledgeIntroDismissed: true },
    });
    assert.equal(res.statusCode, 401);
  });

  it('3. returns default null preferences for a new authenticated user', async () => {
    inMemoryUserPreferences.delete(mockUser1.id);
    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async (id: string) => {
      if (id === mockUser1.id) return mockUser1;
      return null;
    }) as unknown as typeof UserRepository.findById;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.success, true);
      assert.equal(body.data.pledgeIntroSeenAt, null);
      assert.equal(body.data.pledgeIntroVersion, null);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });

  it('4. persists dismissal and introduction version for user 1', async () => {
    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async (id: string) => {
      if (id === mockUser1.id) return mockUser1;
      return null;
    }) as unknown as typeof UserRepository.findById;

    try {
      const updateRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me/preferences',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          pledgeIntroDismissed: true,
          pledgeIntroVersion: 'pledge_intro_v1',
        },
      });

      assert.equal(updateRes.statusCode, 200);
      const updateBody = JSON.parse(updateRes.payload);
      assert.equal(updateBody.success, true);
      assert.equal(updateBody.data.pledgeIntroVersion, 'pledge_intro_v1');
      assert.ok(updateBody.data.pledgeIntroSeenAt);

      // Verify subsequent GET retrieves the persisted preference
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(getRes.statusCode, 200);
      const getBody = JSON.parse(getRes.payload);
      assert.equal(getBody.data.pledgeIntroVersion, 'pledge_intro_v1');
      assert.ok(getBody.data.pledgeIntroSeenAt);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });

  it('5. maintains independent preferences for different authenticated users', async () => {
    inMemoryUserPreferences.delete(mockUser2.id);
    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async (id: string) => {
      if (id === mockUser1.id) return mockUser1;
      if (id === mockUser2.id) return mockUser2;
      return null;
    }) as unknown as typeof UserRepository.findById;

    try {
      // User 2 preferences should still be null
      const resUser2 = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: { authorization: `Bearer ${otherUserToken}` },
      });
      assert.equal(resUser2.statusCode, 200);
      const bodyUser2 = JSON.parse(resUser2.payload);
      assert.equal(bodyUser2.data.pledgeIntroVersion, null);
      assert.equal(bodyUser2.data.pledgeIntroSeenAt, null);

      // User 1 preferences remain intact
      const resUser1 = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(resUser1.statusCode, 200);
      const bodyUser1 = JSON.parse(resUser1.payload);
      assert.equal(bodyUser1.data.pledgeIntroVersion, 'pledge_intro_v1');
      assert.ok(bodyUser1.data.pledgeIntroSeenAt);
    } finally {
      UserRepository.findById = originalFindById;
    }
  });

  it('6. works via /auth/me/preferences alias', async () => {
    const originalFindById = UserRepository.findById;
    UserRepository.findById = (async (id: string) => {
      if (id === mockUser1.id) return mockUser1;
      return null;
    }) as unknown as typeof UserRepository.findById;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me/preferences',
        headers: { authorization: `Bearer ${userToken}` },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.equal(body.data.pledgeIntroVersion, 'pledge_intro_v1');
    } finally {
      UserRepository.findById = originalFindById;
    }
  });
});
