import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccountStatus, CategoryProposalStatus, Role, TesterStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { ReviewCategoryRepository } from '../../src/repositories/review-category.repository.js';
import { slugifyCategory } from '../../src/services/review-category.service.js';

const TESTER_ID = '11111111-1111-4111-8111-111111111111';
const UNVERIFIED_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

const CAT_SMELL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_TASTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Phase 4 Review Category Management & Proposals', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  const originalCapability = UserRepository.findReviewCapability;
  const originalFindById = UserRepository.findById;

  const originalListActive = ReviewCategoryRepository.listActive;
  const originalFindCategoryById = ReviewCategoryRepository.findById;
  const originalFindBySlug = ReviewCategoryRepository.findBySlug;
  const originalFindByName = ReviewCategoryRepository.findByName;
  const originalListAdmin = ReviewCategoryRepository.listAdmin;
  const originalCreate = ReviewCategoryRepository.create;
  const originalUpdate = ReviewCategoryRepository.update;
  const originalDeactivate = ReviewCategoryRepository.deactivate;
  const originalMerge = ReviewCategoryRepository.merge;

  const originalCreateProposal = ReviewCategoryRepository.createProposal;
  const originalListProposalsByProposer = ReviewCategoryRepository.listProposalsByProposer;
  const originalListAdminProposals = ReviewCategoryRepository.listAdminProposals;
  const originalFindProposalById = ReviewCategoryRepository.findProposalById;
  const originalFindPendingProposalByName = ReviewCategoryRepository.findPendingProposalByName;
  const originalApproveProposal = ReviewCategoryRepository.approveProposal;
  const originalRejectProposal = ReviewCategoryRepository.rejectProposal;

  const users = new Map<string, any>();
  const categories = new Map<string, any>();
  const proposals = new Map<string, any>();

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';

    users.set(TESTER_ID, {
      id: TESTER_ID,
      email: 'verified.tester@contestos.com',
      name: 'Verified Tester',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.VERIFIED,
      reviewApprovalEnabled: false,
    });

    users.set(UNVERIFIED_ID, {
      id: UNVERIFIED_ID,
      email: 'unverified@contestos.com',
      name: 'Unverified Creator',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: false,
    });

    users.set(ADMIN_ID, {
      id: ADMIN_ID,
      email: 'admin@contestos.com',
      name: 'Admin User',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: true,
    });

    UserRepository.findReviewCapability = async (id: string) => {
      const u = users.get(id);
      if (!u) return null;
      return {
        id: u.id,
        role: u.role,
        accountStatus: u.accountStatus,
        testerStatus: u.testerStatus,
        reviewApprovalEnabled: u.reviewApprovalEnabled,
      };
    };

    UserRepository.findById = async (id: string) => users.get(id) ?? null;

    // Seed test categories
    categories.set(CAT_SMELL_ID, {
      id: CAT_SMELL_ID,
      name: 'Smell',
      slug: 'smell',
      description: 'Aroma profile and scent characteristics',
      defaultWeight: 1.0,
      sortOrder: 1,
      isActive: true,
      mergedIntoId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { scores: 3 },
    });

    categories.set(CAT_TASTE_ID, {
      id: CAT_TASTE_ID,
      name: 'Taste',
      slug: 'taste',
      description: 'Flavor profile on inhale and exhale',
      defaultWeight: 1.5,
      sortOrder: 2,
      isActive: true,
      mergedIntoId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { scores: 2 },
    });

    ReviewCategoryRepository.listActive = async () =>
      Array.from(categories.values()).filter((c) => c.isActive);

    ReviewCategoryRepository.findById = async (id: string) => categories.get(id) ?? null;

    ReviewCategoryRepository.findBySlug = async (slug: string) =>
      Array.from(categories.values()).find((c) => c.slug === slug) ?? null;

    ReviewCategoryRepository.findByName = async (name: string) =>
      Array.from(categories.values()).find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

    ReviewCategoryRepository.listAdmin = async (options?: { includeInactive?: boolean; search?: string }) => {
      let list = Array.from(categories.values());
      if (!options?.includeInactive) list = list.filter((c) => c.isActive);
      if (options?.search) {
        const q = options.search.toLowerCase();
        list = list.filter((c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
      }
      return list;
    };

    ReviewCategoryRepository.create = async (data: any) => {
      const id = randomUUID();
      const cat = {
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { scores: 0 },
      };
      categories.set(id, cat);
      return cat;
    };

    ReviewCategoryRepository.update = async (id: string, data: any) => {
      const existing = categories.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...data, updatedAt: new Date() };
      categories.set(id, updated);
      return updated;
    };

    ReviewCategoryRepository.deactivate = async (id: string) => {
      const existing = categories.get(id);
      if (!existing) throw new Error('Not found');
      existing.isActive = false;
      return existing;
    };

    ReviewCategoryRepository.merge = async (sourceId: string, targetId: string) => {
      const source = categories.get(sourceId);
      const target = categories.get(targetId);
      if (!source || !target) throw new Error('Not found');
      source.isActive = false;
      source.mergedIntoId = targetId;
      return {
        source,
        target,
        repointedScoresCount: source._count.scores,
        totalSourceScores: source._count.scores,
      };
    };

    ReviewCategoryRepository.createProposal = async (data: any) => {
      const id = randomUUID();
      const prop = {
        id,
        name: data.name,
        description: data.description,
        status: CategoryProposalStatus.PENDING,
        proposerId: data.proposerId,
        proposer: users.get(data.proposerId),
        reviewedById: null,
        reviewedBy: null,
        reviewReason: null,
        reviewedAt: null,
        approvedCategoryId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      proposals.set(id, prop);
      return prop;
    };

    ReviewCategoryRepository.listProposalsByProposer = async (proposerId: string) =>
      Array.from(proposals.values()).filter((p) => p.proposerId === proposerId);

    ReviewCategoryRepository.listAdminProposals = async (status?: CategoryProposalStatus) => {
      let list = Array.from(proposals.values());
      if (status) list = list.filter((p) => p.status === status);
      return list;
    };

    ReviewCategoryRepository.findProposalById = async (id: string) => proposals.get(id) ?? null;

    ReviewCategoryRepository.findPendingProposalByName = async (name: string) =>
      Array.from(proposals.values()).find(
        (p) => p.status === CategoryProposalStatus.PENDING && p.name.toLowerCase() === name.trim().toLowerCase(),
      ) ?? null;

    ReviewCategoryRepository.approveProposal = async (proposalId: string, adminId: string, options: any) => {
      const prop = proposals.get(proposalId);
      if (!prop) throw new Error('Proposal not found');
      const catId = randomUUID();
      const newCat = {
        id: catId,
        name: prop.name,
        slug: options.slug,
        description: prop.description,
        defaultWeight: options.defaultWeight ?? 1.0,
        sortOrder: options.sortOrder ?? 10,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { scores: 0 },
      };
      categories.set(catId, newCat);

      prop.status = CategoryProposalStatus.APPROVED;
      prop.reviewedById = adminId;
      prop.reviewedAt = new Date();
      prop.approvedCategoryId = catId;
      prop.approvedCategory = newCat;
      prop.reviewReason = options.reviewReason ?? 'Approved by administrator';

      return { proposal: prop, category: newCat };
    };

    ReviewCategoryRepository.rejectProposal = async (proposalId: string, adminId: string, rejectionReason: string) => {
      const prop = proposals.get(proposalId);
      if (!prop) throw new Error('Proposal not found');
      prop.status = CategoryProposalStatus.REJECTED;
      prop.reviewedById = adminId;
      prop.reviewedAt = new Date();
      prop.reviewReason = rejectionReason;
      return prop;
    };

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    UserRepository.findById = originalFindById;
    ReviewCategoryRepository.listActive = originalListActive;
    ReviewCategoryRepository.findById = originalFindCategoryById;
    ReviewCategoryRepository.findBySlug = originalFindBySlug;
    ReviewCategoryRepository.findByName = originalFindByName;
    ReviewCategoryRepository.listAdmin = originalListAdmin;
    ReviewCategoryRepository.create = originalCreate;
    ReviewCategoryRepository.update = originalUpdate;
    ReviewCategoryRepository.deactivate = originalDeactivate;
    ReviewCategoryRepository.merge = originalMerge;
    ReviewCategoryRepository.createProposal = originalCreateProposal;
    ReviewCategoryRepository.listProposalsByProposer = originalListProposalsByProposer;
    ReviewCategoryRepository.listAdminProposals = originalListAdminProposals;
    ReviewCategoryRepository.findProposalById = originalFindProposalById;
    ReviewCategoryRepository.findPendingProposalByName = originalFindPendingProposalByName;
    ReviewCategoryRepository.approveProposal = originalApproveProposal;
    ReviewCategoryRepository.rejectProposal = originalRejectProposal;
    await app.close();
  });

  function tokenFor(userId: string) {
    const user = users.get(userId);
    return app.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
  }

  it('slugifyCategory properly normalizes category names into slugs', () => {
    assert.equal(slugifyCategory('How High It Gets You'), 'how-high-it-gets-you');
    assert.equal(slugifyCategory('  Terpene Intensity & Richness!  '), 'terpene-intensity-richness');
    assert.equal(slugifyCategory('Smoothness / Burn'), 'smoothness-burn');
  });

  it('GET /api/v1/toke/categories returns active categories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/categories',
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.success, true);
    assert.equal(json.data.length, 2);
    assert.equal(json.data[0].name, 'Smell');
    assert.equal(json.data[1].name, 'Taste');
  });

  it('POST /api/v1/toke/categories/propose blocks unverified users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/categories/propose',
      headers: { authorization: `Bearer ${tokenFor(UNVERIFIED_ID)}` },
      payload: {
        name: 'Packaging & Seal',
        description: 'Quality and seal integrity of the packaging',
      },
    });
    assert.equal(res.statusCode, 403);
  });

  it('POST /api/v1/toke/categories/propose allows verified tester to propose a new category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/categories/propose',
      headers: { authorization: `Bearer ${tokenFor(TESTER_ID)}` },
      payload: {
        name: 'Packaging & Seal',
        description: 'Quality and airtight seal integrity of the packaging container',
      },
    });
    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.body);
    assert.equal(json.success, true);
    assert.equal(json.data.name, 'Packaging & Seal');
    assert.equal(json.data.status, 'PENDING');
  });

  it('POST /api/v1/toke/categories/propose prevents duplicate category proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/categories/propose',
      headers: { authorization: `Bearer ${tokenFor(TESTER_ID)}` },
      payload: {
        name: 'Smell', // already an existing category
        description: 'Checking scent strength and aroma notes',
      },
    });
    assert.equal(res.statusCode, 409);
  });

  it('GET /api/v1/toke/categories/mine returns tester own proposals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/categories/mine',
      headers: { authorization: `Bearer ${tokenFor(TESTER_ID)}` },
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.success, true);
    assert.ok(json.data.length >= 1);
    assert.equal(json.data[0].name, 'Packaging & Seal');
  });

  it('Admin can approve proposal, publishing it to the scorecard', async () => {
    // Find pending proposal
    const prop = Array.from(proposals.values()).find((p) => p.name === 'Packaging & Seal');
    assert.ok(prop);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/categories/proposals/${prop.id}/approve`,
      headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
      payload: {
        defaultWeight: 0.8,
        sortOrder: 3,
        reviewReason: 'Great addition for pre-packaged flower',
      },
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.success, true);
    assert.equal(json.data.proposal.status, 'APPROVED');
    assert.equal(json.data.category.defaultWeight, 0.8);

    // Verify it is now in active categories
    const activeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/categories',
    });
    const activeJson = JSON.parse(activeRes.body);
    assert.ok(activeJson.data.some((c: any) => c.name === 'Packaging & Seal'));
  });

  it('Admin can reject proposal with reason', async () => {
    // Propose another one first
    const propRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/categories/propose',
      headers: { authorization: `Bearer ${tokenFor(TESTER_ID)}` },
      payload: {
        name: 'Store Music Volume',
        description: 'How loud the dispensary played music during the purchase',
      },
    });
    const prop = JSON.parse(propRes.body).data;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/categories/proposals/${prop.id}/reject`,
      headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
      payload: {
        rejectionReason: 'Not relevant to cannabis product quality evaluation',
      },
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.data.status, 'REJECTED');
    assert.equal(json.data.reviewReason, 'Not relevant to cannabis product quality evaluation');
  });

  it('Admin can update category weight and display order', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/toke/categories/${CAT_SMELL_ID}`,
      headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
      payload: {
        defaultWeight: 2.0,
        sortOrder: 1,
      },
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.data.defaultWeight, 2.0);
  });

  it('Admin cannot set invalid non-positive weight', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/toke/categories/${CAT_SMELL_ID}`,
      headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
      payload: {
        defaultWeight: -1,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('Admin can safely merge a source category into a target category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/toke/categories/merge',
      headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
      payload: {
        sourceCategoryId: CAT_TASTE_ID,
        targetCategoryId: CAT_SMELL_ID,
      },
    });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.success, true);
    assert.equal(json.data.source.isActive, false);
    assert.equal(json.data.source.mergedIntoId, CAT_SMELL_ID);
  });
});
