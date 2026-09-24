import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { SYSTEM_CONSTANTS } from '../../src/config/constants.js';

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertSuccessEnvelope(body: Record<string, unknown>, message: string) {
  assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
  assert.equal(body.success, true);
  assert.equal(body.message, message);
  assert.equal(body.errors, null);
  assert.equal('timestamp' in body, false);
}

describe('System routes (M01-P01-T04): GET /api/v1/health and GET /api/v1/', () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 with the api-map health contract', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assertSuccessEnvelope(body, 'Contest Operating System API is healthy');
    assert.deepEqual(Object.keys(body.data).sort(), ['status', 'timestamp']);
    assert.equal(body.data.status, 'healthy');
    assert.match(body.data.timestamp, ISO_TIMESTAMP);
    assert.equal(new Date(body.data.timestamp).toISOString(), body.data.timestamp);
  });

  it('GET /api/v1/ returns 200 with the api-map root contract', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assertSuccessEnvelope(body, 'Hello World from Contest Operating System API!');
    assert.deepEqual(Object.keys(body.data).sort(), ['name', 'version']);
    assert.equal(body.data.version, SYSTEM_CONSTANTS.API_VERSION);
    assert.equal(body.data.version, '1.0.0');
    assert.equal(body.data.name, SYSTEM_CONSTANTS.APP_NAME);
    assert.equal(body.data.name, 'Contest Operating System Backend');
  });

  it('GET /api/v1 (no trailing slash) matches GET /api/v1/', async () => {
    const withSlash = await app.inject({ method: 'GET', url: '/api/v1/' });
    const withoutSlash = await app.inject({ method: 'GET', url: '/api/v1' });

    assert.equal(withSlash.statusCode, 200);
    assert.equal(withoutSlash.statusCode, 200);

    const withBody = JSON.parse(withSlash.payload);
    const withoutBody = JSON.parse(withoutSlash.payload);
    assert.deepEqual(withoutBody, withBody);
  });

  it('health and root are public (200 without Authorization)', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const root = await app.inject({ method: 'GET', url: '/api/v1/' });

    assert.equal(health.statusCode, 200);
    assert.equal(root.statusCode, 200);
  });

  it('OpenAPI spec documents GET /api/v1/health and GET /api/v1/', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    assert.equal(res.statusCode, 200);
    const spec = JSON.parse(res.payload);

    assert.ok(spec.paths['/api/v1/health']?.get);
    assert.equal(spec.paths['/api/v1/health'].get.tags[0], 'System');

    const rootPath = spec.paths['/api/v1/']?.get ?? spec.paths['/api/v1']?.get;
    assert.ok(rootPath, 'OpenAPI spec must include GET /api/v1/ or GET /api/v1');
    assert.equal(rootPath.tags[0], 'System');
  });
});
