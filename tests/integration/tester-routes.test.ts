import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccountStatus, Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { ProductReviewRepository, setProductReviewDb } from '../../src/repositories/product-review.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { buildReviewObjectKey, setStorageService } from '../../src/services/storage.service.js';
import { MemoryReviewDb } from '../unit/memory-review-db.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const TYPE = '55555555-5555-4555-8555-555555555555';
const SMELL = '66666666-6666-4666-8666-666666666666';
const TASTE = '77777777-7777-4777-8777-777777777777';

describe('tester review routes', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let store: MemoryReviewDb;
  const originalCapability = UserRepository.findReviewCapability;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    store = new MemoryReviewDb();
    store.addProduct({
      productId: PRODUCT,
      name: 'Gelato 41',
      brandName: 'Cookies',
      productTypeId: TYPE,
      productTypeName: 'Flower',
      productTypeSlug: 'flower',
    });
    store.addCategory({
      id: SMELL,
      name: 'Smell',
      slug: 'smell',
      defaultWeight: 1,
      isActive: true,
      sortOrder: 1,
    });
    store.addCategory({
      id: TASTE,
      name: 'Taste',
      slug: 'taste',
      defaultWeight: 1,
      isActive: true,
      sortOrder: 2,
    });
    setProductReviewDb(store);
    setStorageService({
      createPresignedUpload: async ({ objectKey }) => ({
        uploadUrl: `https://example.com/${objectKey}?sig=1`,
        objectKey,
        headers: { 'Content-Type': 'video/mp4' },
        expiresInSeconds: 900,
        method: 'PUT',
      }),
      getPublicUrl: (objectKey) => `https://example.com/${objectKey}`,
    });
    UserRepository.findReviewCapability = async (id: string) => ({
      id,
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerEnabled: id === TESTER || id === OTHER,
      reviewApprovalEnabled: false,
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

  function token(id = TESTER): string {
    return app.jwt.sign({ id, email: 'tester@contestos.com', role: Role.CREATOR });
  }

  it('presigns, creates, updates, lists, and submits only the owner’s review', async () => {
    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews/presign',
      headers: { authorization: `Bearer ${token()}` },
      payload: { contentType: 'video/mp4', fileSizeBytes: 2048, durationSeconds: 12 },
    });
    assert.equal(presign.statusCode, 200);
    const signed = JSON.parse(presign.payload).data;
    assert.match(signed.objectKey, new RegExp(`^reviews/${TESTER}/`));
    assert.match(signed.thumbnail.objectKey, /\.jpg$/);
    assert.equal(signed.method, 'PUT');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/reviews',
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        productId: PRODUCT,
        productTypeId: TYPE,
        videoObjectKey: signed.objectKey,
        thumbnailUrl: signed.thumbnail.objectKey,
        durationSeconds: 12,
        city: 'Las Vegas',
        reviewNotes: 'Draft note',
        categoryScores: [
          { categoryId: SMELL, score: 8 },
          { categoryId: TASTE, score: 6 },
        ],
      },
    });
    assert.equal(created.statusCode, 201);
    const review = JSON.parse(created.payload).data;
    assert.equal(review.testerId, TESTER);
    assert.equal(review.status, 'DRAFT');
    assert.equal(review.overallScore, 0);

    const stolen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${review.id}`,
      headers: { authorization: `Bearer ${token(OTHER)}` },
      payload: { reviewNotes: 'not yours' },
    });
    assert.equal(stolen.statusCode, 403);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/toke/reviews/${review.id}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { reviewNotes: 'Updated note' },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(JSON.parse(patched.payload).data.reviewNotes, 'Updated note');

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/reviews/mine?page=1&limit=10',
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(mine.statusCode, 200);
    const mineBody = JSON.parse(mine.payload).data;
    assert.equal(mineBody.items.length, 1);
    assert.equal(mineBody.items[0].id, review.id);

    const otherMine = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/reviews/mine',
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    assert.equal(JSON.parse(otherMine.payload).data.items.length, 0);

    const rejectedScore = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${review.id}/submit`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { overallScore: 10 },
    });
    assert.equal(rejectedScore.statusCode, 400);

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${review.id}/submit`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    assert.equal(submitted.statusCode, 200);
    assert.equal(JSON.parse(submitted.payload).data.status, 'SUBMITTED');
    assert.equal(JSON.parse(submitted.payload).data.overallScore, 7);

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/toke/reviews/${review.id}/submit`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    assert.equal(again.statusCode, 409);
    assert.equal(buildReviewObjectKey({ testerId: TESTER, contentType: 'video/mp4', objectId: randomUUID() }).startsWith('reviews/'), true);
    assert.equal(typeof ProductReviewRepository.findById, 'function');
  });
});
