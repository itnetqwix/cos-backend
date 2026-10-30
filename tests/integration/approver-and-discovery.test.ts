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
const PRODUCT_A = '44444444-4444-4444-8444-444444444444';
const PRODUCT_B = '88888888-8888-4888-8888-888888888888';
const TYPE = '55555555-5555-4555-8555-555555555555';
const SMELL = '66666666-6666-4666-8666-666666666666';
const TASTE = '77777777-7777-4777-8777-777777777777';

describe('approver queue and public discovery', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let store: MemoryReviewDb;
  const originalCapability = UserRepository.findReviewCapability;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    store = new MemoryReviewDb();
    for (const [productId, name] of [
      [PRODUCT_A, 'Gelato 41'],
      [PRODUCT_B, 'Blue Dream'],
    ] as const) {
      store.addProduct({
        productId,
        name,
        brandName: 'Cookies',
        productTypeId: TYPE,
        productTypeName: 'Flower',
        productTypeSlug: 'flower',
      });
    }
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
    UserRepository.findReviewCapability = async (id: string) => ({
      id,
      role: id === APPROVER ? Role.ADMIN : Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerEnabled: id === TESTER,
      reviewApprovalEnabled: id === APPROVER,
    });
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    setProductReviewDb(null);
    setStorageService(null);
    await app.close();
  });

  function token(id: string, role: Role = id === APPROVER ? Role.ADMIN : Role.CREATOR): string {
    return app.jwt.sign({ id, email: `${id.slice(0, 8)}@contestos.com`, role });
  }

  async function createSubmitted(productId: string, scores: Array<[string, number]>, notes: string) {
    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: { contentType: 'video/mp4', fileSizeBytes: 1000, durationSeconds: 10 },
    });
    const signed = JSON.parse(presign.payload).data;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {
        productId,
        productTypeId: TYPE,
        videoObjectKey: signed.objectKey,
        thumbnailUrl: signed.thumbnail.objectKey,
        durationSeconds: 10,
        city: 'Las Vegas',
        reviewNotes: notes,
        categoryScores: scores.map(([categoryId, score]) => ({ categoryId, score })),
      },
    });
    const id = JSON.parse(created.payload).data.id;
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${id}/submit`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: {},
    });
    assert.equal(submitted.statusCode, 200);
    return id as string;
  }

  it('keeps approval and publication separate and hides unpublished reviews', async () => {
    const low = await createSubmitted(PRODUCT_A, [[SMELL, 4], [TASTE, 4]], 'Lower');
    const high = await createSubmitted(PRODUCT_B, [[SMELL, 10], [TASTE, 8]], 'Higher');

    const hidden = await app.inject({ method: 'GET', url: '/api/v1/toke/reviews' });
    assert.equal(hidden.statusCode, 200);
    assert.equal(JSON.parse(hidden.payload).data.items.length, 0);
    const hiddenDetail = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${high}` });
    assert.equal(hiddenDetail.statusCode, 404);

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/toke/reviews/queue',
      headers: { authorization: `Bearer ${token(APPROVER)}` },
    });
    assert.equal(queue.statusCode, 200);
    const queued = JSON.parse(queue.payload).data.items;
    assert.equal(queued.length, 2);
    assert.equal(queued[0].tester.id, TESTER);
    assert.ok(queued[0].categoryScores.length > 0);

    const emptyNotes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${low}/request-changes`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: { notes: ' ' },
    });
    assert.equal(emptyNotes.statusCode, 400);
    const changes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${low}/request-changes`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: { notes: 'Show the jar' },
    });
    assert.equal(changes.statusCode, 200);
    assert.equal(JSON.parse(changes.payload).data.status, 'CHANGES_REQUESTED');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${high}/approve`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: {},
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(JSON.parse(approved.payload).data.status, 'APPROVED');
    assert.equal(JSON.parse(approved.payload).data.publishedAt, null);
    const stillHidden = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${high}` });
    assert.equal(stillHidden.statusCode, 404);

    const tooSoon = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${low}/publish`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: {},
    });
    assert.equal(tooSoon.statusCode, 409);

    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/reviews/${high}/publish`,
      headers: { authorization: `Bearer ${token(APPROVER)}` },
      payload: {},
    });
    assert.equal(published.statusCode, 200);
    assert.equal(JSON.parse(published.payload).data.status, 'PUBLISHED');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${high}` });
    assert.equal(detail.statusCode, 200);
    assert.equal(JSON.parse(detail.payload).data.reviewNotes, 'Higher');
    assert.equal(JSON.parse(detail.payload).data.overallScore, 9);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/reviews?productId=${PRODUCT_B}&productTypeId=${TYPE}&categoryId=${SMELL}&city=Las%20Vegas&testerId=${TESTER}&minOverallScore=8`,
    });
    const items = JSON.parse(list.payload).data.items;
    assert.deepEqual(items.map((item: { id: string }) => item.id), [high]);

    const board = await app.inject({ method: 'GET', url: '/api/v1/toke/leaderboard' });
    const ranked = JSON.parse(board.payload).data;
    assert.equal(ranked.ranking, 'published-review');
    assert.deepEqual(ranked.items.map((item: { id: string }) => item.id), [high]);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${high}`,
      headers: { authorization: `Bearer ${token(TESTER)}` },
      payload: { reviewNotes: 'Unapproved claim' },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(JSON.parse(edited.payload).data.status, 'SUBMITTED');
    const publicAfter = await app.inject({ method: 'GET', url: `/api/v1/toke/reviews/${high}` });
    assert.equal(publicAfter.statusCode, 404);
    const feed = await app.inject({ method: 'GET', url: '/api/v1/toke/reviews' });
    assert.equal(JSON.parse(feed.payload).data.items.some((item: { id: string }) => item.id === high), false);
  });
});
