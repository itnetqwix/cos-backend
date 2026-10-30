import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { setProductReviewDb } from '../../src/repositories/product-review.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { setStorageService } from '../../src/services/storage.service.js';
import { MemoryReviewDb } from '../unit/memory-review-db.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const APPROVER = '22222222-2222-4222-8222-222222222222';
const CREATOR = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const TYPE = '55555555-5555-4555-8555-555555555555';
const SMELL = '66666666-6666-4666-8666-666666666666';
const TASTE = '77777777-7777-4777-8777-777777777777';

describe('M06 One Toke review journey', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  const originalCapability = UserRepository.findReviewCapability;

  before(async () => {
    process.env.NODE_ENV = 'test';
    const store = new MemoryReviewDb();
    store.addProduct({
      productId: PRODUCT,
      name: 'Gelato 41',
      brandName: 'Cookies',
      productTypeId: TYPE,
      productTypeName: 'Flower',
      productTypeSlug: 'flower',
    });
    store.addCategory({ id: SMELL, name: 'Smell', slug: 'smell', defaultWeight: 1, isActive: true, sortOrder: 1 });
    store.addCategory({ id: TASTE, name: 'Taste', slug: 'taste', defaultWeight: 1, isActive: true, sortOrder: 2 });
    setProductReviewDb(store);
    setStorageService({
      createPresignedUpload: async ({ objectKey, contentType }) => ({
        uploadUrl: `https://example.com/${objectKey}`,
        objectKey,
        headers: { 'Content-Type': contentType },
        expiresInSeconds: 900,
        method: 'PUT',
      }),
      getPublicUrl: (objectKey) => `https://example.com/${objectKey}`,
      createPresignedDownload: async (objectKey) => `https://example.com/signed/${objectKey}`,
    });
    UserRepository.findReviewCapability = async (id: string) => {
      if (id === TESTER) {
        return {
          id,
          role: Role.CREATOR,
          accountStatus: AccountStatus.ACTIVE,
          testerEnabled: true,
          reviewApprovalEnabled: false,
        };
      }
      if (id === APPROVER) {
        return {
          id,
          role: Role.CREATOR,
          accountStatus: AccountStatus.ACTIVE,
          testerEnabled: false,
          reviewApprovalEnabled: true,
        };
      }
      return {
        id,
        role: Role.CREATOR,
        accountStatus: AccountStatus.ACTIVE,
        testerEnabled: false,
        reviewApprovalEnabled: false,
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

  function token(id: string): string {
    return app.jwt.sign({ id, email: `${id.slice(0, 8)}@contestos.com`, role: Role.CREATOR });
  }

  it('runs draft, changes, resubmit, publish, and public discovery', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      payload: { contentType: 'video/mp4', fileSizeBytes: 1000, durationSeconds: 10 },
    });
    assert.equal(guest.statusCode, 401);

    const plain = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${token(CREATOR)}` },
      payload: { productId: PRODUCT, videoObjectKey: 'nope', durationSeconds: 10 },
    });
    assert.equal(plain.statusCode, 403);

    const testerQueue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/toke/reviews/queue',
      headers: { authorization: `Bearer ${token(TESTER)}` },
    });
    assert.equal(testerQueue.statusCode, 403);

    const approverUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token(APPROVER)}` },
    });
    assert.equal(approverUsers.statusCode, 403);

    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: { contentType: 'video/mp4', fileSizeBytes: 1000, durationSeconds: 10 },
    });
    assert.equal(presign.statusCode, 200);
    const signed = JSON.parse(presign.payload);
    assert.equal(signed.success, true);
    assert.equal(typeof signed.data.objectKey, 'string');
    assert.equal(signed.data.uploadUrl.startsWith('https://example.com/'), true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {
        productId: PRODUCT,
        productTypeId: TYPE,
        videoObjectKey: signed.data.objectKey,
        thumbnailUrl: signed.data.thumbnail.objectKey,
        durationSeconds: 10,
        dispensaryName: 'Desert Bloom',
        city: 'Las Vegas',
        reviewNotes: 'First pass',
      },
    });
    assert.equal(created.statusCode, 201);
    const draft = JSON.parse(created.payload).data;
    assert.equal(draft.status, 'DRAFT');
    const id = draft.id as string;

    const early = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${id}/submit`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {},
    });
    assert.equal(early.statusCode, 400);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${id}`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {
        reviewNotes: 'Jar is visible',
        categoryScores: [
          { categoryId: SMELL, score: 8 },
          { categoryId: TASTE, score: 6 },
        ],
      },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(JSON.parse(edited.payload).data.status, 'DRAFT');

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${id}/submit`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {},
    });
    assert.equal(submitted.statusCode, 200);
    assert.equal(JSON.parse(submitted.payload).data.status, 'SUBMITTED');
    assert.equal(JSON.parse(submitted.payload).data.overallScore, 7);

    const hidden = await app.inject({ method: 'GET', url: '/api/v1/toke/reviews' });
    assert.equal(JSON.parse(hidden.payload).data.items.length, 0);

    const changes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${id}/request-changes`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: { notes: 'Show the jar closer' },
    });
    assert.equal(changes.statusCode, 200);
    assert.equal(JSON.parse(changes.payload).data.status, 'CHANGES_REQUESTED');

    const revised = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${id}`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: { reviewNotes: 'Closer jar shot' },
    });
    assert.equal(revised.statusCode, 200);
    const resubmitted = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${id}/submit`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {},
    });
    assert.equal(resubmitted.statusCode, 200);
    assert.equal(JSON.parse(resubmitted.payload).data.status, 'SUBMITTED');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${id}/approve`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: {},
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(JSON.parse(approved.payload).data.status, 'APPROVED');
    assert.equal(JSON.parse(approved.payload).data.publishedAt, null);
    const stillHidden = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${id}` });
    assert.equal(stillHidden.statusCode, 404);

    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${id}/publish`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: {},
    });
    assert.equal(published.statusCode, 200);
    assert.equal(JSON.parse(published.payload).data.status, 'PUBLISHED');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${id}` });
    assert.equal(detail.statusCode, 200);
    const body = JSON.parse(detail.payload);
    assert.deepEqual(Object.keys(body).sort(), ['data', 'errors', 'message', 'success']);
    assert.equal(body.data.reviewNotes, 'Closer jar shot');
    assert.equal(body.data.overallScore, 7);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/reviews?productId=${PRODUCT}&productTypeId=${TYPE}&city=Las%20Vegas&minOverallScore=7`,
    });
    assert.deepEqual(
      JSON.parse(list.payload).data.items.map((item: { id: string }) => item.id),
      [id],
    );

    const board = await app.inject({ method: 'GET', url: '/api/v1/toke/leaderboard' });
    assert.equal(JSON.parse(board.payload).data.ranking, 'published-review');
    assert.equal(JSON.parse(board.payload).data.items[0].id, id);
  });
});
