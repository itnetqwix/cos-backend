import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

async function build(shared: boolean) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false });
  const auth = async () => {};
  const hooks = shared ? [auth] : null;
  const onRequest = () => (shared ? hooks! : [auth]);
  app.get('/dating/profile/me', { onRequest: onRequest() }, async () => ({ ok: true }));
  app.post(
    '/dating/photos/presign',
    {
      onRequest: onRequest(),
      config: { rateLimit: { max: 2, timeWindow: 60_000 } },
    },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

test('a shared onRequest array copies the presign limiter onto dating reads', async () => {
  const app = await build(true);
  const first = await app.inject({ method: 'GET', url: '/dating/profile/me' });
  const second = await app.inject({ method: 'GET', url: '/dating/profile/me' });
  const third = await app.inject({ method: 'GET', url: '/dating/profile/me' });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 429);
  await app.close();
});

test('a new onRequest array per route leaves dating reads unlimited', async () => {
  const app = await build(false);
  for (let i = 0; i < 5; i += 1) {
    const res = await app.inject({ method: 'GET', url: '/dating/profile/me' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-ratelimit-limit'], undefined);
  }
  await app.close();
});
