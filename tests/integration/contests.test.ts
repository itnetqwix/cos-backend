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
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';

/**
 * M05-P03 and M05-P05.
 * Repositories are mocked. No database reset.
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const ORG_A = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const ORG_B = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const MISSING_CONTEST = '11111111-1111-4111-8111-111111111111';

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

function organizationSummary(id: string) {
  if (id === ORG_A) return { id: ORG_A, name: 'Ripskis Entertainment', slug: 'ripskis' };
  if (id === ORG_B) return { id: ORG_B, name: 'Nike Global', slug: 'nike' };
  return { id, name: 'Unknown', slug: 'unknown' };
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
    organization: organizationSummary(contest.organizationId),
  };
}

describe('M05 contest APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let memory: Memory;

  const originalOrgFind = OrganizationRepository.findById;
  const originalCategory = {
    create: CategoryRepository.create,
    listByOrganization: CategoryRepository.listByOrganization,
    findById: CategoryRepository.findById,
    findByOrganizationAndSlug: CategoryRepository.findByOrganizationAndSlug,
  };
  const originalContest = {
    create: ContestRepository.create,
    findById: ContestRepository.findById,
    list: ContestRepository.list,
    update: ContestRepository.update,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
    memory = createMemory();

    OrganizationRepository.findById = (async (id: string) => {
      if (id !== ORG_A && id !== ORG_B) return null;
      return {
        id,
        name: organizationSummary(id).name,
        slug: organizationSummary(id).slug,
        branding: { primaryColor: '#FF5722', logoUrl: 'https://ripskis.com/logo.png' },
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        updatedAt: new Date('2026-01-10T00:00:00.000Z'),
      };
    }) as unknown as typeof OrganizationRepository.findById;

    CategoryRepository.create = (async (data) => {
      const row: CategoryRecord = {
        id: uuid(memory.seq++, 'cat'),
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        organizationId: data.organizationId,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      };
      memory.categories.set(row.id, row);
      return row;
    }) as typeof CategoryRepository.create;

    CategoryRepository.listByOrganization = (async (organizationId: string) =>
      [...memory.categories.values()].filter((row) => row.organizationId === organizationId)) as typeof CategoryRepository.listByOrganization;

    CategoryRepository.findById = (async (id: string) =>
      memory.categories.get(id) ?? null) as typeof CategoryRepository.findById;

    CategoryRepository.findByOrganizationAndSlug = (async (organizationId: string, slug: string) => {
      for (const row of memory.categories.values()) {
        if (row.organizationId === organizationId && row.slug === slug) return row;
      }
      return null;
    }) as typeof CategoryRepository.findByOrganizationAndSlug;

    ContestRepository.create = (async (data: CreateContestData) => {
      const now = new Date('2026-10-02T00:00:00.000Z');
      const row: ContestRecord = attach(memory, {
        id: uuid(memory.seq++, 'contest'),
        organizationId: data.organizationId,
        categoryId: data.categoryId,
        category: null,
        organization: organizationSummary(data.organizationId),
        title: data.title,
        description: data.description,
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
          if (filters.organizationId && row.organizationId !== filters.organizationId) return false;
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
  });

  after(async () => {
    OrganizationRepository.findById = originalOrgFind;
    CategoryRepository.create = originalCategory.create;
    CategoryRepository.listByOrganization = originalCategory.listByOrganization;
    CategoryRepository.findById = originalCategory.findById;
    CategoryRepository.findByOrganizationAndSlug = originalCategory.findByOrganizationAndSlug;
    ContestRepository.create = originalContest.create;
    ContestRepository.findById = originalContest.findById;
    ContestRepository.list = originalContest.list;
    ContestRepository.update = originalContest.update;
    await app.close();
  });

  function token(role: Role, organizationId: string | null, id = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890'): string {
    return app.jwt.sign({
      id,
      email: `${role.toLowerCase()}@contestos.com`,
      role,
      organizationId,
    });
  }

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(body.errors, success ? null : body.errors);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  }

  const createBody = {
    organizationId: ORG_A,
    title: 'Summer Comedy Slam',
    description: 'Short comedy entries.',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T00:00:00.000Z',
    prizeSummary: '25000 USD',
    rules: ['Be original'],
    category: { name: 'Comedy Skits' },
  };

  async function createDraft(organizationId = ORG_A, role = Role.BRAND_ADMIN) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(role, role === Role.SUPER_ADMIN ? null : organizationId)}` },
      payload: { ...createBody, organizationId },
    });
    assert.equal(res.statusCode, 201);
    return JSON.parse(res.payload).data;
  }

  it('rejects unauthenticated, wrong-role, invalid, and cross-tenant writes', async () => {
    memory = createMemory();

    const missing = await app.inject({ method: 'GET', url: '/api/v1/contests' });
    assert.equal(missing.statusCode, 401);
    assertEnvelope(JSON.parse(missing.payload), false);

    const creator = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.CREATOR, null)}` },
      payload: createBody,
    });
    assert.equal(creator.statusCode, 403);
    assertEnvelope(JSON.parse(creator.payload), false);

    const viewer = await app.inject({
      method: 'GET',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.VIEWER, null)}` },
    });
    assert.equal(viewer.statusCode, 403);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { ...createBody, endDate: '2026-09-01T00:00:00.000Z', criteria: ['humor'] },
    });
    assert.equal(invalid.statusCode, 400);
    assertEnvelope(JSON.parse(invalid.payload), false);

    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { ...createBody, organizationId: ORG_B },
    });
    assert.equal(cross.statusCode, 403);
    assert.match(JSON.parse(cross.payload).message, /own organization/);

    const unknownOrg = await app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: { ...createBody, organizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    assert.equal(unknownOrg.statusCode, 404);
  });

  it('M05-P05-T01 DRAFT → SCHEDULED → ACTIVE for the owning brand admin', async () => {
    memory = createMemory();
    const created = await createDraft();
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.autoAdvanceDelayMs, 1800);
    assert.equal(created.organization.slug, 'ripskis');
    assert.equal(created.category.slug, 'comedy-skits');
    assert.equal(created.organizationId, ORG_A);

    const scheduled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { status: 'SCHEDULED' },
    });
    assert.equal(scheduled.statusCode, 200);
    assert.equal(JSON.parse(scheduled.payload).data.status, 'SCHEDULED');

    const skipped = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { status: 'JUDGING' },
    });
    assert.equal(skipped.statusCode, 409);
    assert.match(JSON.parse(skipped.payload).message, /Invalid contest status transition/);

    const active = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { status: 'ACTIVE' },
    });
    assert.equal(active.statusCode, 200);
    const body = JSON.parse(active.payload);
    assertEnvelope(body, true);
    assert.equal(body.data.status, 'ACTIVE');
    assert.equal(body.message, 'Contest updated successfully');
  });

  it('lists with tenant, status, and category filters and hides other organizations from BRAND_ADMIN', async () => {
    memory = createMemory();
    const own = await createDraft(ORG_A, Role.BRAND_ADMIN);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${own.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { status: 'SCHEDULED' },
    });
    const other = await createDraft(ORG_B, Role.SUPER_ADMIN);

    const scoped = await app.inject({
      method: 'GET',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
    });
    assert.equal(scoped.statusCode, 200);
    const scopedBody = JSON.parse(scoped.payload);
    assertEnvelope(scopedBody, true);
    assert.equal(scopedBody.data.length, 1);
    assert.equal(scopedBody.data[0].id, own.id);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/contests?tenantId=${ORG_B}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
    });
    assert.equal(foreign.statusCode, 403);

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/contests',
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
    });
    assert.equal(JSON.parse(all.payload).data.length, 2);

    const byTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/contests?tenantId=${ORG_B}&status=DRAFT&category=comedy-skits`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
    });
    const filtered = JSON.parse(byTenant.payload).data;
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, other.id);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${MISSING_CONTEST}`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
    });
    assert.equal(missing.statusCode, 404);
    assert.match(JSON.parse(missing.payload).message, /Contest not found/);

    const wrongOrg = await app.inject({
      method: 'GET',
      url: `/api/v1/contests/${other.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
    });
    assert.equal(wrongOrg.statusCode, 403);
  });

  it('M05-P05-T02 rejects rule and category changes when ACTIVE', async () => {
    memory = createMemory();
    const created = await createDraft();
    for (const status of ['SCHEDULED', 'ACTIVE']) {
      const step = await app.inject({
        method: 'PATCH',
        url: `/api/v1/contests/${created.id}`,
        headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
        payload: { status },
      });
      assert.equal(step.statusCode, 200);
    }

    const rules = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { rules: ['Changed after go-live'] },
    });
    assert.equal(rules.statusCode, 409);
    assert.match(JSON.parse(rules.payload).message, /cannot be modified once a contest is ACTIVE/);

    const category = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { category: { name: 'Pets' } },
    });
    assert.equal(category.statusCode, 409);

    const title = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: { title: 'Renamed live contest' },
    });
    assert.equal(title.statusCode, 409);
    assert.equal(memory.contests.get(created.id)?.title, 'Summer Comedy Slam');

    const judging = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
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
        headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
        payload: { status },
      });
      assert.equal(step.statusCode, 200, status);
    }

    const editCompleted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { description: 'Rewrite history' },
    });
    assert.equal(editCompleted.statusCode, 409);
    assert.match(JSON.parse(editCompleted.payload).message, /read-only historical records/);

    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: { status: 'ARCHIVED' },
    });
    assert.equal(archived.statusCode, 200);
    assert.equal(JSON.parse(archived.payload).data.status, 'ARCHIVED');

    const editArchived = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: { prizeSummary: '0 USD' },
    });
    assert.equal(editArchived.statusCode, 409);
    assert.match(JSON.parse(editArchived.payload).message, /read-only/);

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contests/${created.id}`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
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
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
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
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, ORG_A)}` },
      payload: { status: 'SCHEDULED', prizeSummary: '1000 USD' },
    });
    assert.equal(scheduled.statusCode, 200);
    assert.equal(JSON.parse(scheduled.payload).data.prizeSummary, '1000 USD');
    assert.equal(JSON.parse(scheduled.payload).data.status, 'SCHEDULED');
  });
});
