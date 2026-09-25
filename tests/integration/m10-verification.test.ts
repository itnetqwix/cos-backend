import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { ContestStatus, OrganizationStatus, Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';
import {
  ContestRecord,
  ContestRepository,
  CreateContestData,
  UpdateContestData,
} from '../../src/repositories/contest.repository.js';

/**
 * M10-P03-T01 and M10-P03-T02, driven end to end through the HTTP API.
 * Organization and contest repositories share one in-memory store.
 */

const ORG_A = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const ORG_B = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const CONTEST_A = 'bbbbbbbb-bbbb-4bbb-8bbb-00000000000a';
const CONTEST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-00000000000b';

interface Org {
  id: string;
  name: string;
  slug: string;
  branding: null;
  status: OrganizationStatus;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function seed() {
  const at = new Date('2026-01-10T00:00:00.000Z');
  const org = (id: string, name: string, slug: string): Org => ({
    id,
    name,
    slug,
    branding: null,
    status: OrganizationStatus.ACTIVE,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at,
    updatedAt: at,
  });
  const contest = (id: string, organizationId: string, o: Org): ContestRecord => ({
    id,
    organizationId,
    categoryId: null,
    category: null,
    organization: { id: o.id, name: o.name, slug: o.slug },
    title: `Contest ${o.slug}`,
    description: 'Seeded',
    status: ContestStatus.DRAFT,
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    endDate: new Date('2026-11-30T00:00:00.000Z'),
    prizeSummary: null,
    rules: null,
    autoAdvanceDelayMs: 1800,
    createdAt: at,
    updatedAt: at,
  });
  const a = org(ORG_A, 'Ripskis Entertainment', 'ripskis');
  const b = org(ORG_B, 'Nike Global', 'nike');
  return {
    orgs: new Map([
      [ORG_A, a],
      [ORG_B, b],
    ]),
    contests: new Map([
      [CONTEST_A, contest(CONTEST_A, ORG_A, a)],
      [CONTEST_B, contest(CONTEST_B, ORG_B, b)],
    ]),
    seq: 1,
  };
}

describe('M10-P03 super-admin verification', { concurrency: false }, () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof seed>;
  let contestWrites = 0;
  const originalOrg = {
    findById: OrganizationRepository.findById,
    findAll: OrganizationRepository.findAll,
    suspend: OrganizationRepository.suspend,
    reinstate: OrganizationRepository.reinstate,
  };
  const originalContest = {
    create: ContestRepository.create,
    findById: ContestRepository.findById,
    update: ContestRepository.update,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();

    OrganizationRepository.findById = (async (id: string) =>
      store.orgs.get(id) ?? null) as unknown as typeof OrganizationRepository.findById;
    OrganizationRepository.findAll = (async () => [
      ...store.orgs.values(),
    ]) as unknown as typeof OrganizationRepository.findAll;
    OrganizationRepository.suspend = (async (id: string, reason: string, at: Date) => {
      const org = store.orgs.get(id)!;
      Object.assign(org, {
        status: OrganizationStatus.SUSPENDED,
        suspendedAt: at,
        suspensionReason: reason,
      });
      return org;
    }) as unknown as typeof OrganizationRepository.suspend;
    OrganizationRepository.reinstate = (async (id: string) => {
      const org = store.orgs.get(id)!;
      Object.assign(org, {
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      });
      return org;
    }) as unknown as typeof OrganizationRepository.reinstate;

    ContestRepository.findById = (async (id: string) =>
      store.contests.get(id) ?? null) as typeof ContestRepository.findById;
    ContestRepository.create = (async (data: CreateContestData) => {
      contestWrites += 1;
      const o = store.orgs.get(data.organizationId)!;
      const row: ContestRecord = {
        id: `cccccccc-cccc-4ccc-8ccc-${String(store.seq++).padStart(12, '0')}`,
        organizationId: data.organizationId,
        categoryId: null,
        category: null,
        organization: { id: o.id, name: o.name, slug: o.slug },
        title: data.title,
        description: data.description,
        status: ContestStatus.DRAFT,
        startDate: data.startDate,
        endDate: data.endDate,
        prizeSummary: data.prizeSummary,
        rules: null,
        autoAdvanceDelayMs: data.autoAdvanceDelayMs,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.contests.set(row.id, row);
      return row;
    }) as typeof ContestRepository.create;
    ContestRepository.update = (async (id: string, data: UpdateContestData) => {
      contestWrites += 1;
      const current = store.contests.get(id)!;
      const next = { ...current, ...data } as ContestRecord;
      store.contests.set(id, next);
      return next;
    }) as typeof ContestRepository.update;
  });

  beforeEach(() => {
    store = seed();
    contestWrites = 0;
  });

  after(async () => {
    Object.assign(OrganizationRepository, originalOrg);
    Object.assign(ContestRepository, originalContest);
    await app.close();
  });

  function auth(role: Role, organizationId: string | null) {
    return {
      authorization: `Bearer ${app.jwt.sign({
        id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        email: `${role.toLowerCase()}@contestos.com`,
        role,
        organizationId,
      })}`,
    };
  }

  const superAdmin = () => auth(Role.SUPER_ADMIN, null);

  const suspendA = () =>
    app.inject({
      method: 'POST',
      url: `/api/v1/super-admin/organizations/${ORG_A}/suspend`,
      headers: superAdmin(),
      payload: { reason: 'Compliance review' },
    });

  const createIn = (orgId: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/contests',
      headers,
      payload: {
        organizationId: orgId,
        title: 'New contest',
        description: 'Desc',
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
      },
    });

  const patch = (id: string, headers: Record<string, string>, payload: object) =>
    app.inject({ method: 'PATCH', url: `/api/v1/contests/${id}`, headers, payload });

  // --------------------------------------------------------------- P03-T01

  describe('P03-T01 BRAND_ADMIN cannot suspend tenants', () => {
    it('own organization, another organization, and reinstate are all 403 with no state change', async () => {
      for (const [orgId, target] of [
        [ORG_A, ORG_A],
        [ORG_A, ORG_B],
      ]) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/super-admin/organizations/${target}/suspend`,
          headers: auth(Role.BRAND_ADMIN, orgId),
          payload: { reason: 'self-service' },
        });
        assert.equal(res.statusCode, 403);
        const body = JSON.parse(res.payload);
        assert.equal(body.success, false);
        assert.equal(body.data, null);
      }
      assert.equal(store.orgs.get(ORG_A)!.status, OrganizationStatus.ACTIVE);
      assert.equal(store.orgs.get(ORG_B)!.status, OrganizationStatus.ACTIVE);

      await suspendA();
      const reinstate = await app.inject({
        method: 'POST',
        url: `/api/v1/super-admin/organizations/${ORG_A}/reinstate`,
        headers: auth(Role.BRAND_ADMIN, ORG_A),
        payload: {},
      });
      assert.equal(reinstate.statusCode, 403);
      assert.equal(store.orgs.get(ORG_A)!.status, OrganizationStatus.SUSPENDED);
    });

    it('BRAND_ADMIN branding tenant isolation is unchanged (cross-tenant PUT still 403)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/organizations/${ORG_B}/branding`,
        headers: auth(Role.BRAND_ADMIN, ORG_A),
        payload: { primaryColor: '#123456', logoUrl: 'https://x.test/l.png' },
      });
      assert.equal(res.statusCode, 403);
      assert.match(JSON.parse(res.payload).message, /own organization/);
    });
  });

  // --------------------------------------------------------------- P03-T02

  describe('P03-T02 suspended organization blocks contest writes', () => {
    it('BRAND_ADMIN create and PATCH are 409 after suspension; nothing is written', async () => {
      assert.equal((await suspendA()).statusCode, 200);

      const create = await createIn(ORG_A, auth(Role.BRAND_ADMIN, ORG_A));
      assert.equal(create.statusCode, 409);
      const body = JSON.parse(create.payload);
      assert.deepEqual(Object.keys(body).sort(), ['data', 'errors', 'message', 'success']);
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.match(body.message, /Organization is suspended/);

      const meta = await patch(CONTEST_A, auth(Role.BRAND_ADMIN, ORG_A), { title: 'Renamed' });
      assert.equal(meta.statusCode, 409);
      const status = await patch(CONTEST_A, auth(Role.BRAND_ADMIN, ORG_A), {
        status: 'SCHEDULED',
      });
      assert.equal(status.statusCode, 409);

      assert.equal(contestWrites, 0);
      assert.equal(store.contests.get(CONTEST_A)!.title, 'Contest ripskis');
    });

    it('SUPER_ADMIN contest writes to a suspended organization are also 409', async () => {
      await suspendA();
      assert.equal((await createIn(ORG_A, superAdmin())).statusCode, 409);
      assert.equal((await patch(CONTEST_A, superAdmin(), { title: 'x' })).statusCode, 409);
      assert.equal(contestWrites, 0);
    });

    it('contest reads still work while suspended', async () => {
      await suspendA();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/contests/${CONTEST_A}`,
        headers: auth(Role.BRAND_ADMIN, ORG_A),
      });
      assert.equal(res.statusCode, 200);
    });

    it('another organization is not blocked (cross-tenant isolation)', async () => {
      await suspendA();
      assert.equal((await createIn(ORG_B, auth(Role.BRAND_ADMIN, ORG_B))).statusCode, 201);
      assert.equal(
        (await patch(CONTEST_B, auth(Role.BRAND_ADMIN, ORG_B), { title: 'Nike renamed' }))
          .statusCode,
        200,
      );
    });

    it('existing M05 ownership still wins: BRAND_ADMIN of B writing to suspended A is 403', async () => {
      await suspendA();
      assert.equal((await createIn(ORG_A, auth(Role.BRAND_ADMIN, ORG_B))).statusCode, 403);
      assert.equal(
        (await patch(CONTEST_A, auth(Role.BRAND_ADMIN, ORG_B), { title: 'x' })).statusCode,
        403,
      );
    });

    it('reinstating the organization unblocks contest writes', async () => {
      await suspendA();
      const reinstate = await app.inject({
        method: 'POST',
        url: `/api/v1/super-admin/organizations/${ORG_A}/reinstate`,
        headers: superAdmin(),
      });
      assert.equal(reinstate.statusCode, 200);
      assert.equal((await createIn(ORG_A, auth(Role.BRAND_ADMIN, ORG_A))).statusCode, 201);
      const renamed = await patch(CONTEST_A, auth(Role.BRAND_ADMIN, ORG_A), { title: 'Back' });
      assert.equal(renamed.statusCode, 200);
      assert.equal(JSON.parse(renamed.payload).data.title, 'Back');
    });

    it('SUPER_ADMIN list reflects every organization with its own status', async () => {
      await suspendA();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/super-admin/organizations',
        headers: superAdmin(),
      });
      const byId = Object.fromEntries(
        JSON.parse(res.payload).data.map((o: { id: string; status: string }) => [o.id, o.status]),
      );
      assert.deepEqual(byId, { [ORG_A]: 'SUSPENDED', [ORG_B]: 'ACTIVE' });
    });
  });
});
