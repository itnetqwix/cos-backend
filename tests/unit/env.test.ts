import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { env } from '../../src/config/env.js';
import { SYSTEM_CONSTANTS } from '../../src/config/constants.js';

describe('Unit Tests: Environment schema (M01-P01-T02)', () => {
  const ENV_KEYS = [
    'AWS_ACCESS_KEY_ID',
    'AWS_REGION',
    'AWS_S3_BUCKET',
    'AWS_SECRET_ACCESS_KEY',
    'DATABASE_URL',
    'DEMO_MEDIA_PORT',
    'DEPLOYMENT_ORGANIZATION_SLUG',
    'JWT_SECRET',
    'LOG_LEVEL',
    'NODE_ENV',
    'PORT',
    'STORAGE_PROVIDER',
  ];

  it('exports only the keys currently defined in env.ts', () => {
    assert.deepEqual(Object.keys(env).sort(), ENV_KEYS);
  });

  it('does not define or export CORS_ORIGIN', () => {
    assert.equal('CORS_ORIGIN' in env, false);
  });

  it('keeps S3 as the default storage provider', () => {
    const envSrc = readFileSync(new URL('../../src/config/env.ts', import.meta.url), 'utf8');
    assert.match(envSrc, /STORAGE_PROVIDER: z\.enum\(\['s3', 'local-demo'\]\)\.default\('s3'\)/);
    assert.match(envSrc, /DEMO_MEDIA_PORT: z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.default\(5055\)/);
    assert.ok(env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'local-demo');
    assert.equal(typeof env.DEMO_MEDIA_PORT, 'number');
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

  it('uses hardcoded CORS origin star and does not read CORS_ORIGIN', () => {
    const corsSrc = readFileSync(new URL('../../src/plugins/cors.ts', import.meta.url), 'utf8');
    assert.match(corsSrc, /origin:\s*'\*'/);
    assert.equal(corsSrc.includes('env.CORS_ORIGIN'), false);
    assert.equal(corsSrc.includes('process.env.CORS_ORIGIN'), false);
  });
});
