import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { SYSTEM_CONSTANTS } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * M12-P01-T03 review. Locks the configuration that already exists.
 * Does not change expiry, claims, or the M01 missing-secret fallback.
 * Minimum length, rotation, and failing boot when JWT_SECRET is unset
 * remain NOT SPECIFIED.
 */
describe('M12-P01-T03 JWT expiry and secret configuration', () => {
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

  it('keeps access-token expiry at the 7d constant', () => {
    assert.equal(SYSTEM_CONSTANTS.JWT_EXPIRES_IN, '7d');
    const jwtPlugin = readFileSync(path.join(root, 'src/plugins/jwt.ts'), 'utf8');
    assert.match(jwtPlugin, /expiresIn:\s*SYSTEM_CONSTANTS\.JWT_EXPIRES_IN/);
    assert.match(jwtPlugin, /secret:\s*env\.JWT_SECRET/);
    assert.equal(jwtPlugin.includes('super-secret'), false);
  });

  it('signs only the frozen claims and a 7-day exp', () => {
    const token = app.jwt.sign({
      id: 'user-jwt-review',
      email: 'jwt-review@contestos.com',
      role: 'CREATOR',
    });
    const decoded = app.jwt.decode(token) as {
      id: string;
      email: string;
      role: string;
      iat: number;
      exp: number;
    };
    assert.equal(decoded.id, 'user-jwt-review');
    assert.equal(decoded.email, 'jwt-review@contestos.com');
    assert.equal(decoded.role, 'CREATOR');
    assert.equal(decoded.exp - decoded.iat, 7 * 24 * 60 * 60);
    const claimKeys = Object.keys(decoded)
      .filter((key) => key !== 'iat' && key !== 'exp')
      .sort();
    assert.deepEqual(claimKeys, ['email', 'id', 'role']);
    if (env.JWT_SECRET.length > 0) {
      assert.equal(token.includes(env.JWT_SECRET), false);
    }
  });
});
