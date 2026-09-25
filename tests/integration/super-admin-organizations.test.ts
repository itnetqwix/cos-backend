import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { OrganizationStatus, Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';

/**
 * M10-P01: SUPER_ADMIN organization list, suspend, and reinstate.
 * Repository is replaced by an in-memory store. No database reset.
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const ADMIN_VIEW_KEYS = [
  'branding',
  'createdAt',
  'id',
  'name',
  'slug',
  'status',
  'suspendedAt',
  'suspensionReason',
  'updatedAt',
];
const BASE = '/api/v1/super-admin/organizations';
const RIPSKIS_ID = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const NIKE_ID = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const MISSING_ID = 'c0ffee00-0000-4000-8000-000000000000';

interface StoredOrg {
  id: string;
  name: string;
  slug: string;
  branding: Record<string, string> | null;
  status: OrganizationStatus;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  users?: unknown;
  passwordHash?: string;
}

function seedOrgs(): Map<string, StoredOrg> {
  return new Map([
    [
      NIKE_ID,
      {
        id: NIKE_ID,
        name: 'Nike Global',
        slug: 'nike',
        branding: { primaryColor: '#000000', logoUrl: 'https://nike.com/logo.png' },
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        // Keys a repository must never leak; the response schema strips them.
        users: [{ id: 'u1', passwordHash: 'hash' }],
        passwordHash: 'should-not-leak',
      },
    ],
    [
      RIPSKIS_ID,
      {
        id: RIPSKIS_ID,
        name: 'Ripskis Entertainment',
        slug: 'ripskis',
        branding: null,
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        updatedAt: new Date('2026-01-10T00:00:00.000Z'),
      },
    ],
  ]);
}

describe('M10-P01 SUPER_ADMIN organization operations', { concurrency: false }, () => {
  let app: FastifyInstance;
  let orgs: Map<string, StoredOrg>;
  let reads = 0;
  let writes = 0;
  const original = {
    findAll: OrganizationRepository.findAll,
    findById: OrganizationRepository.findById,
    findBySlug: OrganizationRepository.findBySlug,
    suspend: OrganizationRepository.suspend,
    reinstate: OrganizationRepository.reinstate,
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();

    OrganizationRepository.findAll = (async () => {
      reads += 1;
      return [...orgs.values()];
    }) as unknown as typeof OrganizationRepository.findAll;

    OrganizationRepository.findById = (async (id: string) => {
      reads += 1;
      return orgs.get(id) ?? null;
    }) as unknown as typeof OrganizationRepository.findById;

    OrganizationRepository.findBySlug = (async (slug: string) => {
      for (const org of orgs.values()) if (org.slug === slug) return org;
      return null;
    }) as unknown as typeof OrganizationRepository.findBySlug;

    OrganizationRepository.suspend = (async (id: string, reason: string, at: Date) => {
      writes += 1;
      const org = orgs.get(id);
      if (!org) throw new Error('missing org');
      Object.assign(org, {
        status: OrganizationStatus.SUSPENDED,
        suspendedAt: at,
        suspensionReason: reason,
      });
      return org;
    }) as unknown as typeof OrganizationRepository.suspend;

    OrganizationRepository.reinstate = (async (id: string) => {
      writes += 1;
      const org = orgs.get(id);
      if (!org) throw new Error('missing org');
      Object.assign(org, {
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      });
      return org;
    }) as unknown as typeof OrganizationRepository.reinstate;
  });

  beforeEach(() => {
    orgs = seedOrgs();
    reads = 0;
    writes = 0;
  });

  after(async () => {
    Object.assign(OrganizationRepository, original);
    await app.close();
  });

  function token(role: Role, organizationId: string | null): string {
    return app.jwt.sign({
      id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      email: `${role.toLowerCase()}@contestos.com`,
      role,
      organizationId,
    });
  }

  const superAdmin = () => ({ authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` });

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
    if (!success) assert.equal(body.data, null);
  }

  function suspend(id: string, headers: Record<string, string>, payload: unknown) {
    return app.inject({ method: 'POST', url: `${BASE}/${id}/suspend`, headers, payload: payload as object });
  }

  function reinstate(id: string, headers: Record<string, string>, payload: unknown = {}) {
    return app.inject({ method: 'POST', url: `${BASE}/${id}/reinstate`, headers, payload: payload as object });
  }

  // ---------------------------------------------------------------- T01 list

  describe('T01 GET /super-admin/organizations', () => {
    it('SUPER_ADMIN receives every organization across tenants', async () => {
      const res = await app.inject({ method: 'GET', url: BASE, headers: superAdmin() });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assertEnvelope(body, true);
      assert.equal(body.message, 'Organizations retrieved successfully');
      assert.equal(body.errors, null);
      assert.deepEqual(
        body.data.map((o: { id: string }) => o.id),
        [NIKE_ID, RIPSKIS_ID],
      );
    });

    it('items are the admin view with branding preserved and no secrets', async () => {
      const res = await app.inject({ method: 'GET', url: BASE, headers: superAdmin() });
      const body = JSON.parse(res.payload);
      for (const item of body.data) {
        assert.deepEqual(Object.keys(item).sort(), ADMIN_VIEW_KEYS);
        assert.equal(item.status, 'ACTIVE');
        assert.equal(item.suspendedAt, null);
        assert.equal(item.suspensionReason, null);
      }
      const nike = body.data.find((o: { id: string }) => o.id === NIKE_ID);
      assert.deepEqual(nike.branding, {
        primaryColor: '#000000',
        logoUrl: 'https://nike.com/logo.png',
      });
      assert.equal(body.data.find((o: { id: string }) => o.id === RIPSKIS_ID).branding, null);
      assert.doesNotMatch(res.payload, /passwordHash|should-not-leak|"users"/);
    });

    it('empty organization table returns 200 with an empty array', async () => {
      orgs = new Map();
      const res = await app.inject({ method: 'GET', url: BASE, headers: superAdmin() });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.payload).data, []);
    });

    it('undocumented query parameters are rejected with 400', async () => {
      for (const query of ['page=1', 'status=SUSPENDED', 'search=nike', 'sort=name']) {
        const res = await app.inject({ method: 'GET', url: `${BASE}?${query}`, headers: superAdmin() });
        assert.equal(res.statusCode, 400, query);
        assertEnvelope(JSON.parse(res.payload), false);
      }
      assert.equal(reads, 0);
    });
  });

  // ------------------------------------------------------------- T02 suspend

  describe('T02 POST /super-admin/organizations/:id/suspend', () => {
    it('SUPER_ADMIN suspends any organization and the state persists', async () => {
      const before = Date.now();
      const res = await suspend(NIKE_ID, superAdmin(), { reason: '  Unresolved copyright claims  ' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assertEnvelope(body, true);
      assert.equal(body.message, 'Organization suspended successfully');
      assert.deepEqual(Object.keys(body.data).sort(), ADMIN_VIEW_KEYS);
      assert.equal(body.data.status, 'SUSPENDED');
      assert.equal(body.data.suspensionReason, 'Unresolved copyright claims');
      const at = Date.parse(body.data.suspendedAt);
      assert.ok(at >= before - 1000 && at <= Date.now() + 1000);
      assert.doesNotMatch(res.payload, /passwordHash|"users"/);

      const stored = orgs.get(NIKE_ID)!;
      assert.equal(stored.status, OrganizationStatus.SUSPENDED);
      assert.equal(stored.suspensionReason, 'Unresolved copyright claims');
      assert.ok(stored.suspendedAt instanceof Date);

      const list = JSON.parse(
        (await app.inject({ method: 'GET', url: BASE, headers: superAdmin() })).payload,
      );
      const listed = list.data.find((o: { id: string }) => o.id === NIKE_ID);
      assert.equal(listed.status, 'SUSPENDED');
      assert.equal(listed.suspensionReason, 'Unresolved copyright claims');
    });

    it('only the target organization changes (other tenant stays ACTIVE)', async () => {
      await suspend(NIKE_ID, superAdmin(), { reason: 'Policy review' });
      assert.equal(orgs.get(RIPSKIS_ID)!.status, OrganizationStatus.ACTIVE);
      assert.equal(orgs.get(RIPSKIS_ID)!.suspendedAt, null);
      assert.equal(orgs.get(RIPSKIS_ID)!.suspensionReason, null);
    });

    it('missing, empty, or whitespace reason is 400 and nothing is written', async () => {
      for (const payload of [{}, { reason: '' }, { reason: '   ' }, { reason: null }]) {
        const res = await suspend(NIKE_ID, superAdmin(), payload);
        assert.equal(res.statusCode, 400, JSON.stringify(payload));
        assertEnvelope(JSON.parse(res.payload), false);
      }
      assert.equal(writes, 0);
      assert.equal(orgs.get(NIKE_ID)!.status, OrganizationStatus.ACTIVE);
    });

    it('invalid organization id is 400', async () => {
      const res = await suspend('not-a-uuid', superAdmin(), { reason: 'x' });
      assert.equal(res.statusCode, 400);
      assertEnvelope(JSON.parse(res.payload), false);
      assert.equal(writes, 0);
    });

    it('unknown organization is 404', async () => {
      const res = await suspend(MISSING_ID, superAdmin(), { reason: 'x' });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.payload);
      assertEnvelope(body, false);
      assert.match(body.message, /Organization not found/);
      assert.equal(writes, 0);
    });

    it('already suspended organization is 409 and keeps the original reason and time', async () => {
      await suspend(NIKE_ID, superAdmin(), { reason: 'First reason' });
      const firstAt = orgs.get(NIKE_ID)!.suspendedAt;
      const res = await suspend(NIKE_ID, superAdmin(), { reason: 'Second reason' });
      assert.equal(res.statusCode, 409);
      assertEnvelope(JSON.parse(res.payload), false);
      assert.equal(orgs.get(NIKE_ID)!.suspensionReason, 'First reason');
      assert.equal(orgs.get(NIKE_ID)!.suspendedAt, firstAt);
    });
  });

  // ----------------------------------------------------------- T03 reinstate

  describe('T03 POST /super-admin/organizations/:id/reinstate', () => {
    it('SUPER_ADMIN reinstates: ACTIVE with suspendedAt and reason cleared', async () => {
      await suspend(RIPSKIS_ID, superAdmin(), { reason: 'Temporary review' });
      const res = await reinstate(RIPSKIS_ID, superAdmin());
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assertEnvelope(body, true);
      assert.equal(body.message, 'Organization reinstated successfully');
      assert.deepEqual(Object.keys(body.data).sort(), ADMIN_VIEW_KEYS);
      assert.equal(body.data.status, 'ACTIVE');
      assert.equal(body.data.suspendedAt, null);
      assert.equal(body.data.suspensionReason, null);

      const stored = orgs.get(RIPSKIS_ID)!;
      assert.equal(stored.status, OrganizationStatus.ACTIVE);
      assert.equal(stored.suspendedAt, null);
      assert.equal(stored.suspensionReason, null);
    });

    it('accepts a request with no body', async () => {
      await suspend(RIPSKIS_ID, superAdmin(), { reason: 'Temporary review' });
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/${RIPSKIS_ID}/reinstate`,
        headers: superAdmin(),
      });
      assert.equal(res.statusCode, 200);
    });

    it('unknown body fields are 400', async () => {
      await suspend(RIPSKIS_ID, superAdmin(), { reason: 'Temporary review' });
      const res = await reinstate(RIPSKIS_ID, superAdmin(), { status: 'ACTIVE' });
      assert.equal(res.statusCode, 400);
      assertEnvelope(JSON.parse(res.payload), false);
      assert.equal(orgs.get(RIPSKIS_ID)!.status, OrganizationStatus.SUSPENDED);
    });

    it('reinstating an ACTIVE organization is 409 and nothing is written', async () => {
      const res = await reinstate(NIKE_ID, superAdmin());
      assert.equal(res.statusCode, 409);
      const body = JSON.parse(res.payload);
      assertEnvelope(body, false);
      assert.match(body.message, /not suspended/);
      assert.equal(writes, 0);
    });

    it('unknown organization is 404 and invalid id is 400', async () => {
      const missing = await reinstate(MISSING_ID, superAdmin());
      assert.equal(missing.statusCode, 404);
      assertEnvelope(JSON.parse(missing.payload), false);
      const invalid = await reinstate('not-a-uuid', superAdmin());
      assert.equal(invalid.statusCode, 400);
      assert.equal(writes, 0);
    });
  });

  // ------------------------------------------------------ deny matrix (T02/T03)

  describe('non-SUPER_ADMIN and unauthenticated callers', () => {
    const calls = [
      { name: 'list', run: (h: Record<string, string>) => app.inject({ method: 'GET', url: BASE, headers: h }) },
      { name: 'suspend', run: (h: Record<string, string>) => suspend(RIPSKIS_ID, h, { reason: 'x' }) },
      { name: 'reinstate', run: (h: Record<string, string>) => reinstate(RIPSKIS_ID, h) },
    ];

    it('BRAND_ADMIN is 403 for its own organization, another one, or none', async () => {
      orgs.get(RIPSKIS_ID)!.status = OrganizationStatus.SUSPENDED;
      for (const orgId of [RIPSKIS_ID, NIKE_ID, null]) {
        for (const call of calls) {
          const res = await call.run({ authorization: `Bearer ${token(Role.BRAND_ADMIN, orgId)}` });
          assert.equal(res.statusCode, 403, `${call.name} ${orgId}`);
          const body = JSON.parse(res.payload);
          assertEnvelope(body, false);
          assert.equal(body.errors, null);
          assert.match(body.message, /Forbidden: User role 'BRAND_ADMIN'/);
        }
      }
      assert.equal(reads, 0);
      assert.equal(writes, 0);
    });

    it('CREATOR, VIEWER, and a PLATFORM_ADMIN alias are 403', async () => {
      for (const role of [Role.CREATOR, Role.VIEWER, 'PLATFORM_ADMIN' as unknown as Role]) {
        for (const call of calls) {
          const res = await call.run({ authorization: `Bearer ${token(role, null)}` });
          assert.equal(res.statusCode, 403, `${call.name} ${role}`);
          assertEnvelope(JSON.parse(res.payload), false);
        }
      }
      assert.equal(writes, 0);
    });

    it('missing and invalid Bearer tokens are 401', async () => {
      for (const call of calls) {
        for (const headers of [{}, { authorization: 'Bearer not.a.valid.token' }]) {
          const res = await call.run(headers);
          assert.equal(res.statusCode, 401, call.name);
          const body = JSON.parse(res.payload);
          assertEnvelope(body, false);
          assert.match(body.message, /Unauthorized/);
        }
      }
      assert.equal(reads, 0);
      assert.equal(writes, 0);
    });
  });

  // ---------------------------------------------------------- public view

  it('public branding GET exposes status only, not the reason or timestamp', async () => {
    await suspend(NIKE_ID, superAdmin(), { reason: 'Internal compliance note' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/nike/branding' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.data.status, 'SUSPENDED');
    assert.equal(body.data.suspendedAt, undefined);
    assert.equal(body.data.suspensionReason, undefined);
    assert.doesNotMatch(res.payload, /Internal compliance note/);
  });
});
