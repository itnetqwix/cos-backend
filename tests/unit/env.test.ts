import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { env } from '../../src/config/env.js';
import { SYSTEM_CONSTANTS } from '../../src/config/constants.js';

describe('Unit Tests: Environment schema (M01-P01-T02)', () => {
  const ENV_KEYS = [
    'API_PUBLIC_ORIGIN',
    'AWS_ACCESS_KEY_ID',
    'AWS_REGION',
    'AWS_S3_BUCKET',
    'AWS_SECRET_ACCESS_KEY',
    'CORS_ORIGINS',
    'DATABASE_URL',
    'GUEST_COOKIE_SAMESITE',
    'JWT_SECRET',
    'LOG_LEVEL',
    'MEDIA_CDN_BASE_URL',
    'NODE_ENV',
    'PORT',
    'STORAGE_PROVIDER',
    'TRUST_PROXY_HOPS',
  ];

  it('exports only the keys currently defined in env.ts', () => {
    assert.deepEqual(Object.keys(env).sort(), ENV_KEYS);
  });

  it('exports an explicit CORS allowlist and guest cookie site', () => {
    assert.equal(env.CORS_ORIGINS.includes('*'), false);
    assert.match(env.API_PUBLIC_ORIGIN, /^https?:\/\/[^/]+$/);
    assert.ok(env.GUEST_COOKIE_SAMESITE === 'lax' || env.GUEST_COOKIE_SAMESITE === 'none');
    assert.equal('CORS_ORIGIN' in env, false);
  });

  it('keeps S3 as the default storage provider', () => {
    const envSrc = readFileSync(new URL('../../src/config/env.ts', import.meta.url), 'utf8');
    assert.match(envSrc, /STORAGE_PROVIDER: z\.enum\(\['s3'\]\)\.default\('s3'\)/);
    assert.equal(env.STORAGE_PROVIDER, 's3');
    assert.equal(envSrc.includes('DEPLOYMENT_ORGANIZATION_SLUG'), false);
  });

  it('exports optional AWS S3 keys as strings', () => {
    assert.equal(typeof env.AWS_REGION, 'string');
    assert.equal(typeof env.AWS_S3_BUCKET, 'string');
    assert.equal(typeof env.AWS_ACCESS_KEY_ID, 'string');
    assert.equal(typeof env.AWS_SECRET_ACCESS_KEY, 'string');
  });

  it('types PORT as a number and documents default 5000', () => {
    assert.equal(typeof env.PORT, 'number');
    assert.equal(Number.isNaN(env.PORT), false);
    assert.equal(SYSTEM_CONSTANTS.DEFAULT_PORT, 5000);
  });

  it('types DATABASE_URL and JWT_SECRET as strings', () => {
    assert.equal(typeof env.DATABASE_URL, 'string');
    assert.equal(typeof env.JWT_SECRET, 'string');
  });

  it('types NODE_ENV as a known enum value and LOG_LEVEL as a string', () => {
    assert.ok(['development', 'production', 'test'].includes(env.NODE_ENV));
    assert.equal(typeof env.LOG_LEVEL, 'string');
  });

  it('keeps JWT expiry as a constant rather than an env var', () => {
    assert.equal(SYSTEM_CONSTANTS.JWT_EXPIRES_IN, '7d');
    assert.equal('JWT_EXPIRES_IN' in env, false);
  });

  it('reads the explicit CORS allowlist and does not reflect a wildcard', () => {
    const corsSrc = readFileSync(new URL('../../src/plugins/cors.ts', import.meta.url), 'utf8');
    assert.equal(corsSrc.includes("origin: '*'"), false);
    assert.match(corsSrc, /env\.CORS_ORIGINS/);
    assert.match(corsSrc, /credentials: true/);
    assert.match(corsSrc, /corsOriginDecision/);
  });
});
