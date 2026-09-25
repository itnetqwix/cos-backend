import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';

/**
 * M04-P02-T04 and M04-P04-T01.
 * Repository is mocked. No database reset.
 */

const ENVELOPE_KEYS = ['data', 'errors', 'message', 'success'];
const RIPSKIS_ID = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const NIKE_ID = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
const RIPSKIS_DEFAULT_BRANDING = {
  primaryColor: '#FF5722',
  logoUrl: 'https://ripskis.com/logo.png',
};

interface StoredOrg {
  id: string;
  name: string;
  slug: string;
  branding: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

function seedOrgs(): Map<string, StoredOrg> {
  const createdAt = new Date('2026-01-10T00:00:00.000Z');
  return new Map([
    [
      RIPSKIS_ID,
      {
        id: RIPSKIS_ID,
        name: 'Ripskis Entertainment',
        slug: 'ripskis',
        branding: { ...RIPSKIS_DEFAULT_BRANDING },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    [
      NIKE_ID,
      {
        id: NIKE_ID,
        name: 'Nike Global',
        slug: 'nike',
        branding: {
          primaryColor: '#000000',
          logoUrl: 'https://nike.com/logo.png',
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
  ]);
}

describe('M04 organization branding APIs', { concurrency: false }, () => {
  let app: FastifyInstance;
  let orgs: Map<string, StoredOrg>;
  const originalFindById = OrganizationRepository.findById;
  const originalFindBySlug = OrganizationRepository.findBySlug;
  const originalUpdate = OrganizationRepository.updateBranding;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();

    orgs = seedOrgs();

    OrganizationRepository.findById = (async (id: string) =>
      orgs.get(id) ?? null) as unknown as typeof OrganizationRepository.findById;

    OrganizationRepository.findBySlug = (async (slug: string) => {
      for (const org of orgs.values()) {
        if (org.slug === slug) return org;
      }
      return null;
    }) as unknown as typeof OrganizationRepository.findBySlug;

    OrganizationRepository.updateBranding = (async (id: string, branding: Record<string, string>) => {
      const org = orgs.get(id);
      if (!org) throw new Error('missing org');
      org.branding = branding;
      org.updatedAt = new Date('2026-09-24T12:00:00.000Z');
      return org;
    }) as unknown as typeof OrganizationRepository.updateBranding;
  });

  beforeEach(() => {
    orgs = seedOrgs();
  });

  after(async () => {
    OrganizationRepository.findById = originalFindById;
    OrganizationRepository.findBySlug = originalFindBySlug;
    OrganizationRepository.updateBranding = originalUpdate;
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

  function assertEnvelope(body: Record<string, unknown>, success: boolean): void {
    assert.deepEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
    assert.equal(body.success, success);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'timestamp'), false);
  }

  it('GET /organizations/ripskis/branding is public and returns the default tenant tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/ripskis/branding',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assertEnvelope(body, true);
    assert.equal(body.data.slug, 'ripskis');
    assert.equal(body.data.id, RIPSKIS_ID);
    assert.deepEqual(body.data.branding, RIPSKIS_DEFAULT_BRANDING);
    assert.equal(body.data.users, undefined);
  });

  it('GET branding does not require a valid bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/ripskis/branding',
      headers: { authorization: 'Bearer not.a.valid.token' },
    });
    assert.equal(res.statusCode, 200);
  });

  it('GET unknown slug returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/missing-brand/branding',
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assertEnvelope(body, false);
    assert.equal(body.data, null);
    assert.match(body.message, /Organization not found/);
  });

  it('M04-P04-T01 Ripskis branding round-trip: PUT then GET returns the new tokens', async () => {
    const next = {
      primaryColor: '#f97316',
      accentColor: '#fbbf24',
      logoUrl: 'https://ripskis.com/logo.png',
      tagline: 'High-Octane Comedy & Short Entertainment Showdowns',
    };

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${RIPSKIS_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, RIPSKIS_ID)}` },
      payload: next,
    });
    assert.equal(put.statusCode, 200);
    const putBody = JSON.parse(put.payload);
    assertEnvelope(putBody, true);
    assert.equal(putBody.message, 'Organization branding updated successfully');
    assert.deepEqual(putBody.data.branding, next);

    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/ripskis/branding',
    });
    assert.equal(get.statusCode, 200);
    const getBody = JSON.parse(get.payload);
    assert.deepEqual(getBody.data.branding, next);
    assert.equal(getBody.data.slug, 'ripskis');
  });

  it('BRAND_ADMIN cannot write another organization (403, stored branding unchanged)', async () => {
    const before = orgs.get(NIKE_ID)?.branding;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${NIKE_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.BRAND_ADMIN, RIPSKIS_ID)}` },
      payload: {
        primaryColor: '#112233',
        logoUrl: 'https://ripskis.com/logo.png',
      },
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assertEnvelope(body, false);
    assert.equal(body.data, null);
    assert.match(body.message, /own organization/);
    assert.deepEqual(orgs.get(NIKE_ID)?.branding, before);
  });

  it('SUPER_ADMIN can update a different organization', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${NIKE_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: {
        primaryColor: '#111111',
        logoUrl: 'https://nike.com/logo.png',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.data.branding.primaryColor, '#111111');
    assert.equal(body.data.slug, 'nike');
  });

  it('CREATOR and VIEWER receive 403 and unauthenticated PUT receives 401', async () => {
    const payload = {
      primaryColor: '#FF5722',
      logoUrl: 'https://ripskis.com/logo.png',
    };

    const creator = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${RIPSKIS_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.CREATOR, null)}` },
      payload,
    });
    assert.equal(creator.statusCode, 403);
    assert.match(JSON.parse(creator.payload).message, /Forbidden/);

    const viewer = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${RIPSKIS_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.VIEWER, null)}` },
      payload,
    });
    assert.equal(viewer.statusCode, 403);

    const missing = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${RIPSKIS_ID}/branding`,
      payload,
    });
    assert.equal(missing.statusCode, 401);
    const missingBody = JSON.parse(missing.payload);
    assertEnvelope(missingBody, false);
    assert.match(missingBody.message, /Unauthorized/);
  });

  it('rejects branding JSON that omits required fields', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${RIPSKIS_ID}/branding`,
      headers: { authorization: `Bearer ${token(Role.SUPER_ADMIN, null)}` },
      payload: { primaryColor: '#FF5722' },
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, false);
    assert.equal(body.data, null);
  });

  it('seed defines Ripskis branding with primaryColor and logoUrl', () => {
    const seedPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../prisma/seed.ts',
    );
    const seed = readFileSync(seedPath, 'utf8');
    assert.match(seed, /slug:\s*'ripskis'/);
    assert.match(seed, /primaryColor:\s*'#FF5722'/);
    assert.match(seed, /logoUrl:\s*'https:\/\/ripskis.com\/logo.png'/);
    assert.doesNotMatch(seed, /themeColor/);
  });

  it('GET route is public and PUT route authorizes BRAND_ADMIN and SUPER_ADMIN', () => {
    const routesPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/routes/index.ts',
    );
    const src = readFileSync(routesPath, 'utf8');
    const getBlock = src.slice(
      src.indexOf("'/organizations/:slug/branding'"),
      src.indexOf("'/organizations/:id/branding'"),
    );
    assert.doesNotMatch(getBlock, /authenticate/);
    assert.match(
      src,
      /\/organizations\/:id\/branding[\s\S]*authorizeRoles\(Role\.BRAND_ADMIN,\s*Role\.SUPER_ADMIN\)/,
    );
  });
});
