import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { HTTP_STATUS, RATE_LIMIT_DEFAULTS } from '../../src/config/constants.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const RATE_URL = '/api/v1/contests/not-a-uuid/videos/not-a-uuid/rate';

describe('M12-P01-T02 rating POST rate limit', () => {
  let app: FastifyInstance;
  const originalFindByEmail = UserRepository.findByEmail;

  before(async () => {
    process.env.NODE_ENV = 'test';
    UserRepository.findByEmail = (async () =>
      null) as unknown as typeof UserRepository.findByEmail;
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findByEmail = originalFindByEmail;
    await app.close();
  });

  it('documents the rating engineering default', () => {
    assert.equal(RATE_LIMIT_DEFAULTS.RATING_MAX, 60);
    assert.equal(RATE_LIMIT_DEFAULTS.RATING_TIME_WINDOW_MS, 60 * 1000);
  });

  it('returns 429 after RATING_MAX requests from one IP and still allows another IP', async () => {
    const limitedIp = '10.20.0.1';

    for (let i = 0; i < RATE_LIMIT_DEFAULTS.RATING_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: RATE_URL,
        remoteAddress: limitedIp,
        payload: { rating: 1 },
      });
      assert.equal(res.statusCode, HTTP_STATUS.BAD_REQUEST);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: RATE_URL,
      remoteAddress: limitedIp,
      payload: { rating: 1 },
    });
    assert.equal(blocked.statusCode, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = JSON.parse(blocked.payload);
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Too many requests');
    assert.equal(body.data, null);
    assert.equal(body.errors, null);
    assert.equal(blocked.payload.includes('passwordHash'), false);

    const otherIp = await app.inject({
      method: 'POST',
      url: RATE_URL,
      remoteAddress: '10.20.0.2',
      headers: { 'x-forwarded-for': limitedIp },
      payload: { rating: 1 },
    });
    assert.equal(otherIp.statusCode, HTTP_STATUS.BAD_REQUEST);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: limitedIp,
      payload: { email: 'rating-limit@contestos.com', password: 'password123' },
    });
    assert.equal(login.statusCode, HTTP_STATUS.UNAUTHORIZED);
  });
});
