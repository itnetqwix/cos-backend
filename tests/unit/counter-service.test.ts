import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { CounterRecord } from '../../src/services/counter-clock.js';
import { CounterStore, setCounterStoreForTests } from '../../src/repositories/counter.repository.js';
import { CounterService, resetCounterTestHooks, setCounterClockForTests } from '../../src/services/counter.service.js';
import { ZodError } from 'zod';

function clone(record: CounterRecord): CounterRecord {
  return {
    ...record,
    weekdayMultipliers: [...record.weekdayMultipliers],
    anchorAt: new Date(record.anchorAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function memoryStore() {
  let row: CounterRecord | null = null;
  let creates = 0;
  let saves = 0;
  let audits = 0;
  const store: CounterStore = {
    async load() {
      return row ? clone(row) : null;
    },
    async createIfMissing(record) {
      if (!row) {
        creates += 1;
        row = clone(record);
      }
      return clone(row);
    },
    async save(record, audit) {
      saves += 1;
      if (audit) audits += 1;
      row = clone(record);
      return clone(row);
    },
    async listAudits() {
      return [];
    },
  };
  return {
    store,
    creates: () => creates,
    saves: () => saves,
    audits: () => audits,
    read: () => (row ? clone(row) : null),
  };
}

describe('counter persistence', () => {
  const mem = memoryStore();
  let clock = new Date('2026-05-01T00:00:00.000Z');

  beforeEach(() => {
    resetCounterTestHooks();
    setCounterStoreForTests(mem.store);
    setCounterClockForTests(() => clock);
  });

  after(() => {
    resetCounterTestHooks();
  });

  it('inserts provisional defaults once and leaves them in place', async () => {
    const first = await CounterService.snapshot();
    assert.equal(first.provisional, true);
    assert.equal(first.hits, '0');
    assert.equal(first.estimateNote.length > 0, true);
    assert.equal(mem.creates(), 1);
    clock = new Date('2026-05-01T00:00:10.000Z');
    const second = await CounterService.snapshot();
    assert.equal(mem.creates(), 1);
    assert.ok(BigInt(second.hits) > BigInt(first.hits));
  });

  it('rejects an invalid update without writing', async () => {
    const beforeHits = (await CounterService.snapshot()).hits;
    const saves = mem.saves();
    await assert.rejects(
      () => CounterService.update('admin-1', { baseRatePerSecond: -1 }),
      (error: unknown) => error instanceof ZodError,
    );
    await assert.rejects(
      () => CounterService.update('admin-1', { timezone: 'Not/AZone' }),
      (error: unknown) => error instanceof ZodError,
    );
    assert.equal(mem.saves(), saves);
    assert.equal((await CounterService.snapshot()).hits, beforeHits);
    assert.equal(mem.audits(), 0);
    assert.equal(mem.read()?.estimatedUsers, '256000000');
    assert.equal(mem.read()?.specialMonth, 4);
    assert.equal(mem.read()?.specialDay, 20);
  });

  it('pauses, resumes, and records the admin id', async () => {
    clock = new Date('2026-05-01T00:01:00.000Z');
    const paused = await CounterService.update('admin-9', { paused: true });
    assert.equal(paused.config.paused, true);
    assert.equal(paused.config.updatedById, 'admin-9');
    assert.equal(mem.audits(), 1);
    const frozen = paused.snapshot.hits;
    clock = new Date('2026-05-02T00:01:00.000Z');
    assert.equal((await CounterService.snapshot()).hits, frozen);
    const resumed = await CounterService.update('admin-9', { paused: false });
    assert.equal(resumed.snapshot.paused, false);
    assert.equal(resumed.snapshot.hits, frozen);
  });
});

describe('counter admin routes', () => {
  let app: FastifyInstance;
  const mem = memoryStore();

  before(async () => {
    process.env.NODE_ENV = 'test';
    resetCounterTestHooks();
    setCounterStoreForTests(mem.store);
    setCounterClockForTests(() => new Date('2026-05-04T12:00:00.000Z'));
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    resetCounterTestHooks();
    await app.close();
  });

  function token(role: Role): string {
    return app.jwt.sign({ id: `user-${role}`, email: `${role}@ripskis.test`, role });
  }

  it('serves a public snapshot and hides admin routes', async () => {
    const pub = await app.inject({ method: 'GET', url: '/api/v1/counter' });
    assert.equal(pub.statusCode, 200);
    const body = JSON.parse(pub.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.provisional, true);
    assert.match(body.data.hits, /^\d+$/);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/admin/counter' });
    assert.equal(missing.statusCode, 401);

    const creator = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/counter',
      headers: { authorization: `Bearer ${token(Role.CREATOR)}` },
      payload: { paused: true },
    });
    assert.equal(creator.statusCode, 403);
    assert.equal(mem.saves(), 0);
  });

  it('lets an admin update and keeps the last valid row after a bad patch', async () => {
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/counter',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { startingEstimate: '42', confirmReset: true, provisional: true, title: 'Hits' },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(JSON.parse(saved.payload).data.snapshot.hits, '42');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/counter',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { april20Multiplier: -4 },
    });
    assert.equal(bad.statusCode, 400);
    const again = await app.inject({ method: 'GET', url: '/api/v1/counter' });
    assert.equal(JSON.parse(again.payload).data.hits, '42');
    assert.equal(JSON.parse(again.payload).data.title, 'Hits');
    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/counter',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    assert.equal(JSON.parse(admin.payload).data.config.startingEstimate, '42');
    assert.ok(Array.isArray(JSON.parse(admin.payload).data.audits));

    const unconfirmed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/counter',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { startingEstimate: '7' },
    });
    assert.equal(unconfirmed.statusCode, 400);
    const kept = await app.inject({ method: 'GET', url: '/api/v1/counter' });
    assert.equal(JSON.parse(kept.payload).data.hits, '42');

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/counter/preview',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { weekendBoost: 3 },
    });
    assert.equal(preview.statusCode, 200);
    const afterPreview = await app.inject({ method: 'GET', url: '/api/v1/admin/counter', headers: { authorization: `Bearer ${token(Role.ADMIN)}` } });
    assert.equal(JSON.parse(afterPreview.payload).data.config.weekendBoost, 1.2);
  });
});
