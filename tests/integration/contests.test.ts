import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { ContestStatus, Prisma, Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { CategoryRepository, CategoryRecord } from '../../src/repositories/category.repository.js';
import {
  ContestListFilters,
  ContestRecord,
  ContestRepository,
  CreateContestData,
  UpdateContestData,
} from '../../src/repositories/contest.repository.js';

/**
 * M05-P03 and M05-P05.
 * Repositories are mocked. No database reset.
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const MISSING_CONTEST = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-0000000000aa';

interface Memory {
  categories: Map<string, CategoryRecord>;
  contests: Map<string, ContestRecord>;
  seq: number;
}

function uuid(n: number, kind: 'cat' | 'contest'): string {
  const hex = n.toString(16).padStart(12, '0');
  return kind === 'cat'
    ? `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`
    : `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
}

function createMemory(): Memory {
  return { categories: new Map(), contests: new Map(), seq: 1 };
}

function attach(memory: Memory, contest: ContestRecord): ContestRecord {
  const category = contest.categoryId ? memory.categories.get(contest.categoryId) ?? null : null;
  return {
    ...contest,
    category: category
      ? {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
        }
      : null,
  };
}

describe('M05 contest APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let memory: Memory;

  const originalCategory = {
    create: CategoryRepository.create,
    findById: CategoryRepository.findById,
    findBySlug: CategoryRepository.findBySlug,
  };
  const originalContest = {
    create: ContestRepository.create,
    findById: ContestRepository.findById,
    list: ContestRepository.list,
    update: ContestRepository.update,
    deleteById: ContestRepository.deleteById,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    memory = createMemory();

    CategoryRepository.create = (async (data) => {
      const row: CategoryRecord = {
        id: uuid(memory.seq++, 'cat'),
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      };
      memory.categories.set(row.id, row);
      return row;
    }) as typeof CategoryRepository.create;

    CategoryRepository.findById = (async (id: string) =>
      memory.categories.get(id) ?? null) as typeof CategoryRepository.findById;

    CategoryRepository.findBySlug = (async (slug: string) => {
      for (const row of memory.categories.values()) {
        if (row.slug === slug) return row;
      }
      return null;
    }) as typeof CategoryRepository.findBySlug;

    ContestRepository.create = (async (data: CreateContestData) => {
      const now = new Date('2026-10-02T00:00:00.000Z');
      const row: ContestRecord = attach(memory, {
        id: uuid(memory.seq++, 'contest'),
        categoryId: data.categoryId,
        category: null,
        title: data.title,
        description: data.description,
        tagline: data.tagline,
        bannerUrl: data.bannerUrl,
        thumbnailUrl: data.thumbnailUrl,
        status: ContestStatus.DRAFT,
        startDate: data.startDate,
        endDate: data.endDate,
        prizeSummary: data.prizeSummary,
        rules: data.rules === null ? null : (data.rules as Prisma.JsonValue),
        autoAdvanceDelayMs: data.autoAdvanceDelayMs,
        createdAt: now,
        updatedAt: now,
      });
      memory.contests.set(row.id, row);
      return row;
    }) as typeof ContestRepository.create;

    ContestRepository.findById = (async (id: string) => {
      const row = memory.contests.get(id);
      return row ? attach(memory, row) : null;
    }) as typeof ContestRepository.findById;

    ContestRepository.list = (async (filters: ContestListFilters) => {
      return [...memory.contests.values()]
        .map((row) => attach(memory, row))
        .filter((row) => {
          if (filters.status && row.status !== filters.status) return false;
          if (filters.categorySlug && row.category?.slug !== filters.categorySlug) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }) as typeof ContestRepository.list;

    ContestRepository.update = (async (id: string, data: UpdateContestData) => {
      const current = memory.contests.get(id);
      if (!current) throw new Error('missing contest');
      const next: ContestRecord = attach(memory, {
        ...current,
        ...data,
        rules: data.rules === undefined ? current.rules : (data.rules as Prisma.JsonValue),
        updatedAt: new Date('2026-10-03T00:00:00.000Z'),
      });
      memory.contests.set(id, next);
      return next;
    }) as typeof ContestRepository.update;

    ContestRepository.deleteById = (async (id: string) => {
      memory.contests.delete(id);
    }) as typeof ContestRepository.deleteById;
  });

  after(async () => {
    CategoryRepository.create = originalCategory.create;
    CategoryRepository.findById = originalCategory.findById;
    CategoryRepository.findBySlug = originalCategory.findBySlug;
    ContestRepository.create = originalContest.create;
    ContestRepository.findById = originalContest.findById;
    ContestRepository.list = originalContest.list;
    ContestRepository.update = originalContest.update;
    ContestRepository.deleteById = originalContest.deleteById;
    await app.close();
  });

  function token(role: Role, id = ADMIN_ID): string {
    return app.jwt.sign({
      id,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
    });
  }

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(body.errors, success ? null : body.errors);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  }

  const createBody = {
    title: 'Summer Comedy Slam',
    description: 'Short comedy entries.',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T00:00:00.000Z',
    prizeSummary: '25000 USD',
    rules: ['Be original'],
    category: { name: 'Comedy Skits' },
  };

  async function createDraft() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: createBody,
    });
    assert.equal(res.statusCode, 201);
    return JSON.parse(res.payload).data;
  }

  it('rejects unauthenticated, wrong-role, and invalid payloads', async () => {
    memory = createMemory();

    const missing = await app.inject({ method: 'GET', url: '/api/v1/contests' });
    assert.equal(missing.statusCode, 401);
    assertEnvelope(JSON.parse(missing.payload), false);

    const creator = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.CREATOR)}` },
      payload: createBody,
    });
    assert.equal(creator.statusCode, 403);
    assertEnvelope(JSON.parse(creator.payload), false);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { ...createBody, endDate: '2026-09-01T00:00:00.000Z', criteria: ['humor'] },
    });
    assert.equal(invalid.statusCode, 400);
    assertEnvelope(JSON.parse(invalid.payload), false);
  });

  it('M05-P05-T01 DRAFT → SCHEDULED → ACTIVE for ADMIN', async () => {
    memory = createMemory();
    const created = await createDraft();
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.autoAdvanceDelayMs, 1800);
    assert.equal(created.category.slug, 'comedy-skits');

    const scheduled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'SCHEDULED' },
    });
    assert.equal(scheduled.statusCode, 200);
    assert.equal(JSON.parse(scheduled.payload).data.status, 'SCHEDULED');

    const skipped = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'JUDGING' },
    });
    assert.equal(skipped.statusCode, 409);
    assert.match(JSON.parse(skipped.payload).message, /Invalid contest status transition/);

    const active = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'ACTIVE' },
    });
    assert.equal(active.statusCode, 200);
    const body = JSON.parse(active.payload);
    assertEnvelope(body, true);
    assert.equal(body.data.status, 'ACTIVE');
    assert.equal(body.message, 'Contest updated successfully');
  });

  it('lists with status and category filters for ADMIN', async () => {
    memory = createMemory();
    const first = await createDraft();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${first.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'SCHEDULED' },
    });
    const second = await createDraft();

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    assert.equal(JSON.parse(all.payload).data.length, 2);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/contests?status=DRAFT&category=comedy-skits',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    const rows = JSON.parse(filtered.payload).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, second.id);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${MISSING_CONTEST}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
    });
    assert.equal(missing.statusCode, 404);
    assert.match(JSON.parse(missing.payload).message, /Contest not found/);
  });

  it('M05-P05-T02 rejects rule and category changes when ACTIVE', async () => {
    memory = createMemory();
    const created = await createDraft();
    for (const status of ['SCHEDULED', 'ACTIVE']) {
      const step = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${created.id}`,
        headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
        payload: { status },
      });
      assert.equal(step.statusCode, 200);
    }

    const rules = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { rules: ['Changed after go-live'] },
    });
    assert.equal(rules.statusCode, 409);
    assert.match(JSON.parse(rules.payload).message, /cannot be modified once a contest is ACTIVE/);

    const category = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { category: { name: 'Pets' } },
    });
    assert.equal(category.statusCode, 409);

    const title = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { title: 'Renamed live contest' },
    });
    assert.equal(title.statusCode, 409);
    assert.equal(memory.contests.get(created.id)?.title, 'Summer Comedy Slam');

    const judging = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'JUDGING' },
    });
    assert.equal(judging.statusCode, 200);
    assert.equal(JSON.parse(judging.payload).data.status, 'JUDGING');
  });

  it('M05-P05-T03 COMPLETED and ARCHIVED are read-only except COMPLETED → ARCHIVED', async () => {
    memory = createMemory();
    const created = await createDraft();
    for (const status of ['SCHEDULED', 'ACTIVE', 'JUDGING', 'COMPLETED']) {
      const step = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${created.id}`,
        headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
        payload: { status },
      });
      assert.equal(step.statusCode, 200, status);
    }

    const editCompleted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { description: 'Rewrite history' },
    });
    assert.equal(editCompleted.statusCode, 409);
    assert.match(JSON.parse(editCompleted.payload).message, /read-only historical records/);

    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'ARCHIVED' },
    });
    assert.equal(archived.statusCode, 200);
    assert.equal(JSON.parse(archived.payload).data.status, 'ARCHIVED');

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'ACTIVE' },
    });
    assert.equal(reopen.statusCode, 409);
    assert.match(JSON.parse(reopen.payload).message, /Invalid contest status transition from ARCHIVED/);
  });

  it('allows metadata edits while DRAFT and keeps SCHEDULED editable', async () => {
    memory = createMemory();
    const created = await createDraft();
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { title: 'Summer Comedy Slam 2026', rules: 'One video each.' },
    });
    assert.equal(edited.statusCode, 200);
    const body = JSON.parse(edited.payload);
    assert.equal(body.data.title, 'Summer Comedy Slam 2026');
    assert.equal(body.data.rules, 'One video each.');
    assert.equal(body.data.status, 'DRAFT');

    const scheduled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: { status: 'SCHEDULED', prizeSummary: '1000 USD' },
    });
    assert.equal(scheduled.statusCode, 200);
    assert.equal(JSON.parse(scheduled.payload).data.prizeSummary, '1000 USD');
    assert.equal(JSON.parse(scheduled.payload).data.status, 'SCHEDULED');
  });

  it('stores the contest visual and prize summary for creators', async () => {
    memory = createMemory();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.ADMIN)}` },
      payload: {
        ...createBody,
        tagline: 'Funniest minute',
        bannerUrl: 'https://images.example.com/banner.jpg',
        thumbnailUrl: 'https://images.example.com/thumb.jpg',
      },
    });
    assert.equal(created.statusCode, 201);
    const contest = JSON.parse(created.payload).data;
    assert.equal(contest.thumbnailUrl, 'https://images.example.com/thumb.jpg');
    assert.equal(contest.bannerUrl, 'https://images.example.com/banner.jpg');
    assert.equal(contest.prizeSummary, '25000 USD');

    const creator = await app.inject({
      method: 'GET',
      url: '/api/v1/creator/contests',
      headers: { authorization: `Bearer ${token(Role.CREATOR, 'dddddddd-dddd-4ddd-8ddd-0000000000dd')}` },
    });
    assert.equal(creator.statusCode, 200);
    const list = JSON.parse(creator.payload).data;
    assert.equal(list.some((row: { id: string }) => row.id === contest.id), true);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/creator/contests/${contest.id}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, 'dddddddd-dddd-4ddd-8ddd-0000000000dd')}` },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(JSON.parse(detail.payload).data.tagline, 'Funniest minute');
    assert.equal(JSON.parse(detail.payload).data.thumbnailUrl, contest.thumbnailUrl);
  });

  it('rejects delete for an active contest and allows delete for a draft', async () => {
    memory = createMemory();
    const created = await createDraft();
    const admin = { authorization: `Bearer ${token(Role.ADMIN)}` };

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contests/${created.id}`,
      headers: admin,
    });
    assert.equal(removed.statusCode, 200);
    assert.equal(JSON.parse(removed.payload).data.id, created.id);
    assert.equal(memory.contests.has(created.id), false);

    const active = await createDraft();
    memory.contests.get(active.id)!.status = ContestStatus.ACTIVE;
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contests/${active.id}`,
      headers: admin,
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(JSON.parse(blocked.payload).message, 'Active contests cannot be deleted');
    assert.equal(memory.contests.has(active.id), true);

    const creator = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contests/${active.id}`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, 'dddddddd-dddd-4ddd-8ddd-0000000000dd')}` },
    });
    assert.equal(creator.statusCode, 403);
    assert.equal(memory.contests.has(active.id), true);
  });
});
