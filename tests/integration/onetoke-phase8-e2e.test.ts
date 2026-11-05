import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, Role, TesterStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setProductReviewDb } from '../../src/repositories/product-review.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { buildReviewObjectKey, setStorageService } from '../../src/services/storage.service.js';
import { MemoryReviewDb } from '../unit/memory-review-db.js';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TESTER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNVERIFIED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRODUCT_TYPE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CATEGORY_1_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CATEGORY_2_ID = '11111111-2222-4333-8444-555555555555';

describe('One Toke Phase 8 End-to-End Integration & Security Suite', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let store: MemoryReviewDb;
  const originalCapability = UserRepository.findReviewCapability;

  const mockUsers: Record<string, any> = {
    [ADMIN_ID]: {
      id: ADMIN_ID,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.VERIFIED,
      testerEnabled: true,
      reviewApprovalEnabled: true,
      name: 'Phil Administrator',
      email: 'phil@onetoke.com',
    },
    [TESTER_ID]: {
      id: TESTER_ID,
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.VERIFIED,
      testerEnabled: true,
      reviewApprovalEnabled: false,
      name: 'Expert Tester Jane',
      email: 'jane@onetoke.com',
      testerBio: 'Certified sommelier with 8 years of cannabis evaluation experience.',
    },
    [UNVERIFIED_ID]: {
      id: UNVERIFIED_ID,
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      testerEnabled: false,
      reviewApprovalEnabled: false,
      name: 'Casual Applicant Bob',
      email: 'bob@example.com',
    },
  };

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';

    store = new MemoryReviewDb();
    store.addProduct({
      productId: PRODUCT_ID,
      name: 'OG Kush Reserve',
      brandName: 'Stiiizy',
      productTypeId: PRODUCT_TYPE_ID,
      productTypeName: 'Flower',
      productTypeSlug: 'flower',
    });
    store.addCategory({
      id: CATEGORY_1_ID,
      name: 'Aroma & Nose',
      slug: 'aroma-and-nose',
      defaultWeight: 1.5,
      isActive: true,
      sortOrder: 1,
    });
    store.addCategory({
      id: CATEGORY_2_ID,
      name: 'Flavor & Terpenes',
      slug: 'flavor-and-terpenes',
      defaultWeight: 1.0,
      isActive: true,
      sortOrder: 2,
    });

    setProductReviewDb(store);
    setStorageService({
      createPresignedUpload: async ({ objectKey, contentType }) => ({
        uploadUrl: `https://storage.onetoke.com/upload/${objectKey}`,
        objectKey,
        headers: { 'Content-Type': contentType },
        expiresInSeconds: 900,
        method: 'PUT',
      }),
      getPublicUrl: (objectKey) => `https://cdn.onetoke.com/${objectKey}`,
      createPresignedDownload: async (objectKey) => `https://cdn.onetoke.com/signed/${objectKey}`,
    });

    UserRepository.findReviewCapability = async (id: string) => {
      const u = mockUsers[id];
      if (!u) return null;
      return {
        id: u.id,
        role: u.role,
        accountStatus: u.accountStatus,
        testerStatus: u.testerStatus,
        testerEnabled: u.testerEnabled,
        reviewApprovalEnabled: u.reviewApprovalEnabled,
      };
    };

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    setProductReviewDb(null);
    setStorageService(null);
    await app.close();
  });

  function token(user: { id: string; role: Role }): string {
    return app.jwt.sign({
      id: user.id,
      email: `${user.id.slice(0, 8)}@contestos.com`,
      role: user.role,
    });
  }

  it('1. Enforces strict RBAC: Unverified user cannot create drafts or upload videos', async () => {
    const unverifiedToken = token(mockUsers[UNVERIFIED_ID]);

    const presignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${unverifiedToken}` },
      payload: {
        contentType: 'video/mp4',
        fileSizeBytes: 2048000,
        durationSeconds: 30,
      },
    });
    assert.equal(presignRes.statusCode, 403, 'Unverified user must be blocked from presigning review video');

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${unverifiedToken}` },
      payload: {
        productId: PRODUCT_ID,
        videoObjectKey: `reviews/${UNVERIFIED_ID}/unauth-video.mp4`,
        durationSeconds: 25,
      },
    });
    assert.equal(draftRes.statusCode, 403, 'Unverified user must be blocked from creating review draft');
  });

  it('2. Verified tester creates a draft with location, scorecard and valid video object key', async () => {
    const testerToken = token(mockUsers[TESTER_ID]);

    // Presign target
    const presignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        contentType: 'video/mp4',
        fileSizeBytes: 5242880,
        durationSeconds: 45,
      },
    });
    assert.equal(presignRes.statusCode, 200);
    const presignData = presignRes.json().data;
    assert.ok(presignData.objectKey.startsWith(`reviews/${TESTER_ID}/`));
    assert.ok(presignData.uploadUrl);

    // Create draft
    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        productId: PRODUCT_ID,
        videoObjectKey: presignData.objectKey,
        durationSeconds: 45,
        dispensaryName: 'Cookies Maywood',
        dispensaryAddress: '5050 District Blvd',
        city: 'Maywood',
        state: 'CA',
        country: 'USA',
        reviewNotes: 'Sweet pine aroma with an earthy pungent finish.',
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 9 },
          { categoryId: CATEGORY_2_ID, score: 8 },
        ],
      },
    });
    assert.equal(draftRes.statusCode, 201);
    const draft = draftRes.json().data;
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.dispensaryName, 'Cookies Maywood');
    assert.equal(draft.testerId, TESTER_ID);

    // Other users cannot access mine detail
    const otherToken = token(mockUsers[UNVERIFIED_ID]);
    const unauthorizedMine = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/reviews/mine/${draft.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(unauthorizedMine.statusCode, 403, 'Other user cannot read private draft');
  });

  it('3. Complete editorial lifecycle: Draft -> Submit -> Changes Requested -> Edit -> Resubmit -> Approve -> Publish', async () => {
    const testerToken = token(mockUsers[TESTER_ID]);
    const adminToken = token(mockUsers[ADMIN_ID]);

    // Create initial review
    const videoKey = buildReviewObjectKey({ testerId: TESTER_ID, contentType: 'video/mp4' });
    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        productId: PRODUCT_ID,
        videoObjectKey: videoKey,
        durationSeconds: 35,
        dispensaryName: 'Apotheca Dispensary',
        city: 'Denver',
        state: 'CO',
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 8 },
          { categoryId: CATEGORY_2_ID, score: 9 },
        ],
      },
    });
    const reviewId = draftRes.json().data.id;

    // Submit draft
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${reviewId}/submit`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {},
    });
    assert.equal(submitRes.statusCode, 200);
    assert.equal(submitRes.json().data.status, 'SUBMITTED');

    // Admin requests changes
    const changesRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${reviewId}/request-changes`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { notes: 'Please elaborate on the curing quality in your tasting notes.' },
    });
    assert.equal(changesRes.statusCode, 200);
    assert.equal(changesRes.json().data.status, 'CHANGES_REQUESTED');
    assert.equal(changesRes.json().data.changeRequestNotes, 'Please elaborate on the curing quality in your tasting notes.');

    // Tester edits and resubmits
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${reviewId}`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        reviewNotes: 'Exceptional cure with white ash and dense sticky trichomes.',
      },
    });
    assert.equal(updateRes.statusCode, 200);

    const resubmitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${reviewId}/submit`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {},
    });
    assert.equal(resubmitRes.statusCode, 200);
    assert.equal(resubmitRes.json().data.status, 'SUBMITTED');

    // Admin approves
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${reviewId}/approve`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(approveRes.statusCode, 200);
    assert.equal(approveRes.json().data.status, 'APPROVED');

    // Admin publishes
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${reviewId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    assert.equal(publishRes.statusCode, 200);
    assert.equal(publishRes.json().data.status, 'PUBLISHED');
    assert.ok(publishRes.json().data.publishedRevisionId);

    // Public discovery sees the published review
    const publicList = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/reviews',
    });
    assert.equal(publicList.statusCode, 200);
    const pubReviews = publicList.json().data.items;
    const found = pubReviews.find((r: any) => r.id === reviewId);
    assert.ok(found, 'Published review must be discoverable in public feed');
    assert.equal(found.status, 'PUBLISHED');
    assert.equal(found.tester.id, TESTER_ID);
    // Absolute privacy: no email or private fields exposed
    assert.equal(found.tester.email, undefined);
    assert.equal(found.tester.phoneNumber, undefined);
  });

  it('4. Admin proxy authoring: Admin authors review on behalf of verified tester', async () => {
    const adminToken = token(mockUsers[ADMIN_ID]);
    const videoKey = buildReviewObjectKey({ testerId: TESTER_ID, contentType: 'video/mp4' });

    const proxyDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        productId: PRODUCT_ID,
        testerId: TESTER_ID, // Target verified tester
        videoObjectKey: videoKey,
        durationSeconds: 30,
        dispensaryName: 'Denver Rec',
        city: 'Denver',
        state: 'CO',
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 7 },
          { categoryId: CATEGORY_2_ID, score: 8 },
        ],
      },
    });
    assert.equal(proxyDraft.statusCode, 201);
    const data = proxyDraft.json().data;
    assert.equal(data.testerId, TESTER_ID, 'Attributed tester must be the specified tester');
    assert.equal(data.createdByAdminId, ADMIN_ID, 'Creator admin attribution must be recorded');
    assert.equal(data.status, 'DRAFT', 'Proxy review must still start in DRAFT and follow editorial review');
  });

  it('5. Material edit on published review retains published snapshot until re-approved', async () => {
    const testerToken = token(mockUsers[TESTER_ID]);
    const adminToken = token(mockUsers[ADMIN_ID]);
    const videoKey = buildReviewObjectKey({ testerId: TESTER_ID, contentType: 'video/mp4' });

    // 1. Create, submit, approve & publish
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        productId: PRODUCT_ID,
        videoObjectKey: videoKey,
        durationSeconds: 40,
        reviewNotes: 'Original Tasting Notes v1',
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 10 },
          { categoryId: CATEGORY_2_ID, score: 10 },
        ],
      },
    });
    const revId = create.json().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${revId}/submit`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {},
    });
    const approveAndPub = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${revId}/approve-and-publish`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approveAndPub.statusCode, 200);
    const originalPublishedRevId = approveAndPub.json().data.publishedRevisionId;

    // 2. Perform material edit (change category score)
    const materialEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${revId}`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        reviewNotes: 'Updated Material Tasting Notes v2',
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 5 },
          { categoryId: CATEGORY_2_ID, score: 6 },
        ],
      },
    });
    assert.equal(materialEdit.statusCode, 200);
    assert.equal(materialEdit.json().data.status, 'SUBMITTED', 'Material edit transitions review to SUBMITTED');

    // 3. Public discovery detail STILL returns the original published revision snapshot (score 10)
    const publicDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/reviews/${revId}`,
    });
    assert.equal(publicDetail.statusCode, 200);
    const pubData = publicDetail.json().data;
    assert.equal(pubData.publishedRevisionId, originalPublishedRevId);
    assert.equal(pubData.overallScore, 10, 'Public visitors must see frozen published snapshot score');
    assert.equal(pubData.reviewNotes, 'Original Tasting Notes v1', 'Public notes must reflect published snapshot');
  });

  it('6. Disqualification immediately delists review from public feed and leaderboard', async () => {
    const testerToken = token(mockUsers[TESTER_ID]);
    const adminToken = token(mockUsers[ADMIN_ID]);
    const videoKey = buildReviewObjectKey({ testerId: TESTER_ID, contentType: 'video/mp4' });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        productId: PRODUCT_ID,
        videoObjectKey: videoKey,
        durationSeconds: 20,
        categoryScores: [
          { categoryId: CATEGORY_1_ID, score: 6 },
          { categoryId: CATEGORY_2_ID, score: 7 },
        ],
      },
    });
    const revId = create.json().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${revId}/submit`,
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${revId}/approve-and-publish`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // Disqualify review
    const disq = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${revId}/disqualify`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Product recall issued by state regulator.' },
    });
    assert.equal(disq.statusCode, 200);
    assert.equal(disq.json().data.status, 'DISQUALIFIED');

    // Check public list and detail
    const publicList = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/reviews',
    });
    const items = publicList.json().data.items;
    assert.equal(items.some((r: any) => r.id === revId), false, 'Disqualified review must not appear in public feed');

    const publicDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/reviews/${revId}`,
    });
    assert.equal(publicDetail.statusCode, 404, 'Disqualified review must return 404 on public route');
  });

  it('7. Tester suspension immediately blocks review creation', async () => {
    // Temporarily set tester status to SUSPENDED
    mockUsers[TESTER_ID].testerStatus = TesterStatus.SUSPENDED;

    const testerToken = token(mockUsers[TESTER_ID]);
    const presignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${testerToken}` },
      payload: {
        contentType: 'video/mp4',
        fileSizeBytes: 1048576,
        durationSeconds: 20,
      },
    });
    assert.equal(presignRes.statusCode, 403, 'Suspended tester must be blocked from authoring');

    // Restore to VERIFIED
    mockUsers[TESTER_ID].testerStatus = TesterStatus.VERIFIED;
  });
});
