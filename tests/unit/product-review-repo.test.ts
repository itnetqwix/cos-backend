import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ProductReviewRepository,
  setProductReviewDb,
  type ReviewDb,
} from '../../src/repositories/product-review.repository.js';
import { buildReviewObjectKey } from '../../src/services/storage.service.js';
import { ConflictError, ForbiddenError } from '../../src/utils/response.js';
import { MemoryReviewDb } from './memory-review-db.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PRODUCT_A = '44444444-4444-4444-8444-444444444444';
const PRODUCT_B = '77777777-7777-4777-8777-777777777777';
const SMELL = '55555555-5555-4555-8555-555555555555';
const TASTE = '66666666-6666-4666-8666-666666666666';

function video(testerId: string): string {
  return buildReviewObjectKey({
    testerId,
    contentType: 'video/mp4',
    objectId: randomUUID(),
  });
}

function seed(store: MemoryReviewDb): void {
  store.addProduct({
    productId: PRODUCT_A,
    name: 'Gelato 41',
    brandName: 'Cookies',
    productTypeId: 'flower',
    productTypeName: 'Flower',
    productTypeSlug: 'flower',
  });
  store.addProduct({
    productId: PRODUCT_B,
    name: 'Live Resin',
    brandName: 'Jetty',
    productTypeId: 'concentrate',
    productTypeName: 'Concentrate',
    productTypeSlug: 'concentrate',
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
}

describe('product review repository', { concurrency: 1 }, () => {
  let store: MemoryReviewDb;

  before(() => {
    store = new MemoryReviewDb();
    seed(store);
    setProductReviewDb(store);
  });

  after(() => {
    setProductReviewDb(null);
  });

  it('creates, reads, lists, and updates a tester draft', async () => {
    const created = await ProductReviewRepository.createDraft({
      productId: PRODUCT_A,
      testerId: TESTER,
      videoUrl: 'https://example.com/video.mp4',
      videoObjectKey: video(TESTER),
      durationSeconds: 12,
      city: 'Las Vegas',
      state: 'NV',
      dispensaryName: 'Planet 13',
      reviewNotes: 'First pass',
    });
    assert.equal(created.status, ReviewStatus.DRAFT);
    assert.equal(created.country, 'USA');
    assert.equal(created.product.name, 'Gelato 41');
    assert.equal((await ProductReviewRepository.findById(created.id))?.id, created.id);

    const updated = await ProductReviewRepository.updateDraft(created.id, TESTER, {
      reviewNotes: 'Second pass',
      categoryScores: [
        { categoryId: SMELL, score: 8, weightApplied: 1 },
        { categoryId: TASTE, score: 6, weightApplied: 1 },
      ],
    });
    assert.equal(updated.reviewNotes, 'Second pass');
    assert.equal(updated.categoryScores.length, 2);
    const owned = await ProductReviewRepository.listByTester(TESTER);
    assert.equal(owned.some((review) => review.id === created.id), true);
    await assert.rejects(
      () => ProductReviewRepository.updateDraft(created.id, OTHER, { reviewNotes: 'nope' }),
      ForbiddenError,
    );
  });

  it('snapshots a new version without overwriting the previous one or the published pointer', async () => {
    const created = await ProductReviewRepository.createDraft({
      productId: PRODUCT_A,
      testerId: TESTER,
      videoUrl: 'https://example.com/video.mp4',
      videoObjectKey: video(TESTER),
      durationSeconds: 20,
      reviewNotes: 'Published notes',
    });
    await ProductReviewRepository.replaceCategoryScores(created.id, [
      { categoryId: SMELL, score: 9, weightApplied: 1 },
      { categoryId: TASTE, score: 7, weightApplied: 1 },
    ]);
    await ProductReviewRepository.saveScore(
      created.id,
      8,
      [{ categoryId: SMELL, name: 'Smell', slug: 'smell', weight: 1 }],
    );
    const first = await ProductReviewRepository.transaction((tx) =>
      ProductReviewRepository.createRevisionSnapshot(created.id, tx, {
        changedById: TESTER,
        changeReason: 'publish',
      }),
    );
    const current = await ProductReviewRepository.findById(created.id);
    assert.ok(current);
    assert.equal(current.publishedRevisionId, null);
    const publishedAt = new Date('2026-10-01T00:00:00.000Z');
    await ProductReviewRepository.saveIfCurrent(
      created.id,
      { status: current.status, updatedAt: current.updatedAt },
      { status: ReviewStatus.PUBLISHED, publishedAt, publishedRevisionId: first.id },
    );
    await ProductReviewRepository.saveScore(created.id, 4, current.weightsSnapshot);
    const second = await ProductReviewRepository.transaction((tx) =>
      ProductReviewRepository.createRevisionSnapshot(created.id, tx, {
        changedById: TESTER,
        changeReason: 'material edit',
      }),
    );
    const revisions = await ProductReviewRepository.listRevisions(created.id);
    assert.deepEqual(
      revisions.map((revision) => revision.version),
      [1, 2],
    );
    assert.equal(revisions[0].id, first.id);
    assert.equal(revisions[0].overallScore, 8);
    assert.equal(revisions[0].reviewNotes, 'Published notes');
    assert.equal(revisions[0].productSnapshot.name, 'Gelato 41');
    assert.equal(revisions[0].productSnapshot.productTypeSlug, 'flower');
    assert.equal(revisions[0].scoresSnapshot.length, 2);
    assert.equal(revisions[1].id, second.id);
    assert.equal(revisions[1].overallScore, 4);
    const still = await ProductReviewRepository.findById(created.id);
    assert.equal(still?.publishedRevisionId, first.id);
    assert.notEqual(revisions[0].videoObjectKey, '');

    const stub = {
      async findReview() {
        return still;
      },
      async maxRevisionVersion() {
        return 1;
      },
      async insertRevision() {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      },
    } as unknown as ReviewDb;
    await assert.rejects(
      () => ProductReviewRepository.createRevisionSnapshot(created.id, stub),
      ConflictError,
    );
  });

  it('returns only published revisions and applies discovery filters', async () => {
    const hidden = await ProductReviewRepository.createDraft({
      productId: PRODUCT_B,
      testerId: OTHER,
      videoUrl: 'https://example.com/hidden.mp4',
      videoObjectKey: video(OTHER),
      durationSeconds: 8,
      city: 'Denver',
      state: 'CO',
    });
    const visible = await ProductReviewRepository.createDraft({
      productId: PRODUCT_B,
      testerId: OTHER,
      videoUrl: 'https://example.com/visible.mp4',
      videoObjectKey: video(OTHER),
      durationSeconds: 9,
      city: 'Denver',
      state: 'CO',
      dispensaryName: 'Cookies Maywood',
    });
    await ProductReviewRepository.replaceCategoryScores(visible.id, [
      { categoryId: SMELL, score: 10, weightApplied: 1 },
    ]);
    await ProductReviewRepository.saveScore(visible.id, 9.5, [
      { categoryId: SMELL, name: 'Smell', slug: 'smell', weight: 1 },
    ]);
    const revision = await ProductReviewRepository.transaction((tx) =>
      ProductReviewRepository.createRevisionSnapshot(visible.id, tx, { changedById: OTHER }),
    );
    const row = await ProductReviewRepository.findById(visible.id);
    assert.ok(row);
    await ProductReviewRepository.saveIfCurrent(
      visible.id,
      { status: row.status, updatedAt: row.updatedAt },
      {
        status: ReviewStatus.PUBLISHED,
        publishedAt: new Date('2026-10-15T00:00:00.000Z'),
        publishedRevisionId: revision.id,
      },
    );
    await ProductReviewRepository.saveScore(visible.id, 1, row.weightsSnapshot);

    const all = await ProductReviewRepository.listPublishedReviews();
    assert.equal(all.some((item) => item.reviewId === hidden.id), false);
    const found = all.find((item) => item.reviewId === visible.id);
    assert.ok(found);
    assert.equal(found.overallScore, 9.5);
    assert.equal(found.productSnapshot.name, 'Live Resin');

    const filtered = await ProductReviewRepository.listPublishedReviews({
      productId: PRODUCT_B,
      productTypeId: 'concentrate',
      categoryId: SMELL,
      testerId: OTHER,
      city: 'Denver',
      state: 'CO',
      dispensaryName: 'Cookies Maywood',
      minOverallScore: 9,
      maxOverallScore: 10,
      publishedFrom: new Date('2026-10-01T00:00:00.000Z'),
      publishedTo: new Date('2026-10-31T00:00:00.000Z'),
    });
    assert.deepEqual(
      filtered.map((item) => item.reviewId),
      [visible.id],
    );
    const missed = await ProductReviewRepository.listPublishedReviews({ city: 'Las Vegas', productId: PRODUCT_B });
    assert.equal(missed.some((item) => item.reviewId === visible.id), false);

    const pending = await ProductReviewRepository.findById(visible.id);
    assert.ok(pending);
    await ProductReviewRepository.saveIfCurrent(
      visible.id,
      { status: pending.status, updatedAt: pending.updatedAt },
      { status: ReviewStatus.SUBMITTED },
    );
    const duringReapproval = await ProductReviewRepository.listPublishedReviews({ productId: PRODUCT_B });
    assert.equal(duringReapproval.find((item) => item.reviewId === visible.id)?.overallScore, 9.5);
    assert.equal(duringReapproval.find((item) => item.reviewId === visible.id)?.publishedRevisionId, revision.id);
  });

  it('rejects a second status write that lost the race', async () => {
    const created = await ProductReviewRepository.createDraft({
      productId: PRODUCT_A,
      testerId: TESTER,
      videoUrl: 'https://example.com/race.mp4',
      videoObjectKey: video(TESTER),
      durationSeconds: 10,
    });
    const results = await Promise.allSettled([
      ProductReviewRepository.saveIfCurrent(
        created.id,
        { status: created.status, updatedAt: created.updatedAt },
        { status: ReviewStatus.SUBMITTED },
      ),
      ProductReviewRepository.saveIfCurrent(
        created.id,
        { status: created.status, updatedAt: created.updatedAt },
        { status: ReviewStatus.SUBMITTED },
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].status === 'rejected' && rejected[0].reason instanceof ConflictError);
  });
});
