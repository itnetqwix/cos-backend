import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

const APP_TS = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');

describe('Unit Tests: Plugin registration (M01-P01-T03)', () => {
  it('registers cors, helmet, prisma, jwt, swagger, then routes in that source order', () => {
    const registers = [...APP_TS.matchAll(/await app\.register\((\w+)/g)].map(
      (match) => match[1],
    );

    assert.deepEqual(registers, [
      'corsPlugin',
      'helmetPlugin',
      'prismaPlugin',
      'jwtPlugin',
      'swaggerPlugin',
      'routes',
    ]);
  });

  it('sets the global error handler before plugin registration', () => {
    const errorHandlerAt = APP_TS.indexOf('app.setErrorHandler(globalErrorHandler)');
    const firstPluginAt = APP_TS.indexOf('await app.register(corsPlugin)');
    assert.ok(errorHandlerAt >= 0);
    assert.ok(firstPluginAt >= 0);
    assert.ok(errorHandlerAt < firstPluginAt);
  });
});

describe('Runtime: Plugin presence after buildApp (M01-P01-T03)', () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('decorates prisma and authenticate from prisma and jwt plugins', () => {
    assert.equal(typeof app.prisma, 'object');
    assert.equal(typeof app.authenticate, 'function');
    assert.equal(typeof app.jwt, 'object');
  });

  it('serves Swagger UI at /docs not /documentation', async () => {
    const docs = await app.inject({ method: 'GET', url: '/docs/' });
    assert.equal(docs.statusCode, 200);
    assert.ok(docs.payload.includes('swagger-ui'));

    const missing = await app.inject({ method: 'GET', url: '/documentation' });
    assert.equal(missing.statusCode, 404);
  });

  it('applies CORS and Helmet response headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:3000' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers['x-content-type-options']);
  });
});
