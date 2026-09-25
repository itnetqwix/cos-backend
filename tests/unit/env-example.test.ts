import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { env } from '../../src/config/env.js';

const ENV_EXAMPLE = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const GITIGNORE = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const ENV_TS = readFileSync(new URL('../../src/config/env.ts', import.meta.url), 'utf8');

const EXAMPLE_KEYS = [...ENV_EXAMPLE.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1],
);

function jwtFallbackInEnvTs(): string | null {
  const match = ENV_TS.match(/JWT_SECRET:\s*z\.string\(\)\.default\('([^']+)'\)/);
  return match ? match[1] : null;
}

describe('Unit Tests: .env.example template (M01-P01-T05)', () => {
  it('lists exactly the keys exported by env.ts', () => {
    assert.deepEqual(EXAMPLE_KEYS.slice().sort(), Object.keys(env).sort());
  });

  it('does not document unsupported keys', () => {
    const blocked = ['CORS_ORIGIN', 'JWT_EXPIRES_IN'];
    for (const key of blocked) {
      assert.equal(EXAMPLE_KEYS.includes(key), false, `${key} must not appear as an assignment`);
    }
  });

  it('uses placeholders rather than committed secrets', () => {
    assert.match(ENV_EXAMPLE, /PORT=5000/);
    assert.match(ENV_EXAMPLE, /NODE_ENV=development/);
    assert.match(ENV_EXAMPLE, /LOG_LEVEL=info/);
    assert.match(ENV_EXAMPLE, /JWT_SECRET="your-super-secret-key"/);
    assert.match(ENV_EXAMPLE, /AWS_REGION="us-east-1"/);
    assert.match(ENV_EXAMPLE, /AWS_S3_BUCKET="your-cos-video-bucket"/);
    assert.match(ENV_EXAMPLE, /AWS_ACCESS_KEY_ID="your-access-key-id"/);
    assert.match(ENV_EXAMPLE, /AWS_SECRET_ACCESS_KEY="your-secret-access-key"/);
    assert.equal(ENV_EXAMPLE.includes('AKIA'), false);
    assert.match(ENV_EXAMPLE, /localhost:5432/);
    assert.equal(ENV_EXAMPLE.includes('neon.tech'), false);
    assert.equal(ENV_EXAMPLE.includes('npg_'), false);
    assert.equal(ENV_EXAMPLE.includes('neondb_owner'), false);

    const fallback = jwtFallbackInEnvTs();
    assert.ok(fallback && fallback.length > 0);
    assert.equal(ENV_EXAMPLE.includes(fallback), false);
  });

  it('gitignore ignores real env files and keeps .env.example committable', () => {
    assert.match(GITIGNORE, /^\.env$/m);
    assert.match(GITIGNORE, /^\.env\.\*$/m);
    assert.match(GITIGNORE, /^!\.env\.example$/m);
  });

  it('README env docs do not paste live credentials', () => {
    assert.match(README, /\.env\.example/);
    assert.equal(README.includes('neon.tech'), false);
    assert.equal(README.includes('npg_'), false);
    assert.equal(README.includes('neondb_owner'), false);
    const fallback = jwtFallbackInEnvTs();
    assert.ok(fallback);
    assert.equal(README.includes(fallback), false);
  });
});
