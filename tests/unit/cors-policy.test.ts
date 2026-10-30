import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  DISCOVERED_PRODUCTION_API_ORIGIN,
  DISCOVERED_PRODUCTION_FRONTEND_ORIGINS,
  resolveDeploymentCors,
} from '../../src/config/cors-policy.js';
import { corsPluginOptions } from '../../src/plugins/cors.js';

describe('credentialed CORS policy', () => {
  it('uses the discovered same-site production origins when unset', () => {
    const resolved = resolveDeploymentCors({ nodeEnv: 'production', port: 5000 });
    assert.deepEqual(resolved.origins, [...DISCOVERED_PRODUCTION_FRONTEND_ORIGINS]);
    assert.equal(resolved.apiOrigin, DISCOVERED_PRODUCTION_API_ORIGIN);
    assert.equal(resolved.sameSite, 'lax');
    assert.equal(resolved.origins.includes('*'), false);
  });

  it('uses localhost for development and keeps the cookie same-site', () => {
    const resolved = resolveDeploymentCors({ nodeEnv: 'development', port: 8000 });
    assert.deepEqual(resolved.origins, ['http://localhost:3000']);
    assert.equal(resolved.apiOrigin, 'http://localhost:8000');
    assert.equal(resolved.sameSite, 'lax');
  });

  it('selects SameSite=None only for a cross-site frontend', () => {
    const resolved = resolveDeploymentCors({
      nodeEnv: 'production',
      port: 5000,
      corsOrigins: 'https://preview.example.net',
      apiPublicOrigin: 'https://api.ripskis.com',
    });
    assert.equal(resolved.sameSite, 'none');
  });

  it('rejects wildcard, paths, and a lax cookie on a cross-site pair', () => {
    assert.throws(
      () => resolveDeploymentCors({ nodeEnv: 'development', port: 5000, corsOrigins: '*' }),
      /cannot be \*/,
    );
    assert.throws(
      () =>
        resolveDeploymentCors({
          nodeEnv: 'development',
          port: 5000,
          corsOrigins: 'http://localhost:3000/app',
        }),
      /must not include a path/,
    );
    assert.throws(
      () =>
        resolveDeploymentCors({
          nodeEnv: 'production',
          port: 5000,
          corsOrigins: 'https://preview.example.net',
          apiPublicOrigin: 'https://api.ripskis.com',
          sameSiteOverride: 'lax',
        }),
      /cross-site/,
    );
    assert.throws(
      () =>
        resolveDeploymentCors({
          nodeEnv: 'production',
          port: 5000,
          corsOrigins: 'http://localhost:3000',
        }),
      /loopback/,
    );
  });

  it('allows only listed origins and answers preflight without reflecting others', async () => {
    const app = Fastify({ logger: false });
    await app.register(cors, corsPluginOptions(['http://localhost:3000']));
    app.get('/health', async () => ({ ok: true }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
    assert.equal(allowed.statusCode, 200);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.match(String(preflight.headers['access-control-allow-methods']), /POST/);

    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(denied.statusCode, 200);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
    assert.equal(denied.headers['access-control-allow-credentials'], undefined);
    assert.equal(JSON.stringify(denied.headers).includes('evil.example'), false);

    const server = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(server.statusCode, 200);
    assert.equal(server.headers['access-control-allow-origin'], undefined);
    assert.equal(server.headers['access-control-allow-credentials'], undefined);

    await app.close();
  });
});
