import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { RATE_LIMIT_DEFAULTS, HTTP_STATUS } from '../../src/config/constants.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const LOGIN_BODY = {
  email: 'rate-limit@contestos.com',
  password: 'password123',
};

function assertEnvelope(body: Record<string, unknown>) {
  assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
}

const CREATOR_BODY = {
  email: 'rate-limit-creator@contestos.com',
  password: 'password123',
  name: 'Rate Limit',
};

const BRAND_BODY = {
  email: 'rate-limit-brand@contestos.com',
  password: 'password123',
  name: 'Brand Admin',
  organizationName: 'Rate Limit Org',
  slug: 'rate-limit-org',
};

describe('M12-P01-T01 auth credential rate limit', () => {
  let app: FastifyInstance;
  let lookups = 0;
  let creatorWrites = 0;
  let brandWrites = 0;
  const originalFindByEmail = UserRepository.findByEmail;
  const originalCreateCreator = UserRepository.createCreator;
  const originalFindOrganizationBySlug = UserRepository.findOrganizationBySlug;
  const originalCreateBrand = UserRepository.createBrandWithOrganization;

  before(async () => {
    process.env.NODE_ENV = 'test';
    UserRepository.findByEmail = (async () => {
      lookups += 1;
      return null;
    }) as unknown as typeof UserRepository.findByEmail;
    UserRepository.findOrganizationBySlug = (async () =>
      null) as unknown as typeof UserRepository.findOrganizationBySlug;
    UserRepository.createCreator = (async () => {
      creatorWrites += 1;
      return {
        id: 'creator-rate-limit',
        email: CREATOR_BODY.email,
        name: CREATOR_BODY.name,
        role: 'CREATOR',
        organizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as unknown as typeof UserRepository.createCreator;
    UserRepository.createBrandWithOrganization = (async () => {
      brandWrites += 1;
      return {
        user: {
          id: 'brand-rate-limit',
          email: BRAND_BODY.email,
          name: BRAND_BODY.name,
          role: 'BRAND_ADMIN',
          organizationId: 'org-rate-limit',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        organization: {
          id: 'org-rate-limit',
          name: BRAND_BODY.organizationName,
          slug: BRAND_BODY.slug,
        },
      };
    }) as unknown as typeof UserRepository.createBrandWithOrganization;
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findByEmail = originalFindByEmail;
    UserRepository.createCreator = originalCreateCreator;
    UserRepository.findOrganizationBySlug = originalFindOrganizationBySlug;
    UserRepository.createBrandWithOrganization = originalCreateBrand;
    await app.close();
  });

  it('documents engineering defaults (not a business-rule threshold)', () => {
    assert.equal(RATE_LIMIT_DEFAULTS.AUTH_MAX, 10);
    assert.equal(RATE_LIMIT_DEFAULTS.AUTH_TIME_WINDOW_MS, 15 * 60 * 1000);
  });

  it('limits login, creator register, and brand register per IP on separate counters', async () => {
    const limitedIp = '10.12.0.1';

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.AUTH_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: limitedIp,
        payload: LOGIN_BODY,
      });
      assert.equal(res.statusCode, HTTP_STATUS.UNAUTHORIZED);
    }

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: limitedIp,
      payload: LOGIN_BODY,
    });
    assert.equal(blockedLogin.statusCode, HTTP_STATUS.TOO_MANY_REQUESTS);
    const blockedBody = JSON.parse(blockedLogin.payload);
    assertEnvelope(blockedBody);
    assert.equal(blockedBody.success, false);
    assert.equal(blockedBody.message, 'Too many requests');
    assert.equal(blockedBody.data, null);
    assert.equal(blockedBody.errors, null);
    assert.equal(blockedLogin.payload.includes('passwordHash'), false);
    assert.equal(blockedLogin.payload.includes('node_modules'), false);
    assert.equal(blockedLogin.payload.includes('JWT_SECRET'), false);
    assert.equal(lookups, RATE_LIMIT_DEFAULTS.AUTH_MAX);

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.AUTH_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/creator',
        remoteAddress: limitedIp,
        payload: CREATOR_BODY,
      });
      assert.equal(res.statusCode, HTTP_STATUS.CREATED);
      assert.equal(res.payload.includes('passwordHash'), false);
    }
    const blockedCreator = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/creator',
      remoteAddress: limitedIp,
      payload: CREATOR_BODY,
    });
    assert.equal(blockedCreator.statusCode, HTTP_STATUS.TOO_MANY_REQUESTS);
    assert.equal(creatorWrites, RATE_LIMIT_DEFAULTS.AUTH_MAX);

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.AUTH_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/brand',
        remoteAddress: limitedIp,
        payload: BRAND_BODY,
      });
      assert.equal(res.statusCode, HTTP_STATUS.CREATED);
      assert.equal(res.payload.includes('passwordHash'), false);
    }
    const blockedBrand = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/brand',
      remoteAddress: limitedIp,
      payload: BRAND_BODY,
    });
    assert.equal(blockedBrand.statusCode, HTTP_STATUS.TOO_MANY_REQUESTS);
    assert.equal(brandWrites, RATE_LIMIT_DEFAULTS.AUTH_MAX);

    const otherIp = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.12.0.2',
      headers: { 'x-forwarded-for': limitedIp },
      payload: LOGIN_BODY,
    });
    assert.equal(otherIp.statusCode, HTTP_STATUS.UNAUTHORIZED);
    // Login, creator register, and brand register each call findByEmail.
    // The three blocked requests do not. One extra login from another IP does.
    assert.equal(lookups, RATE_LIMIT_DEFAULTS.AUTH_MAX * 3 + 1);

    const health = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      remoteAddress: limitedIp,
    });
    assert.equal(health.statusCode, HTTP_STATUS.OK);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      remoteAddress: limitedIp,
    });
    assert.equal(me.statusCode, HTTP_STATUS.UNAUTHORIZED);
    assert.equal(JSON.parse(me.payload).message.includes('Too many requests'), false);
  });
});
