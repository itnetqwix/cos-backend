import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, ReviewStatus, Role, TesterStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ProductReviewRepository,
  setProductReviewDb,
} from '../../src/repositories/product-review.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { ProductReviewLifecycleService } from '../../src/services/product-review-lifecycle.service.js';
import { buildReviewObjectKey } from '../../src/services/storage.service.js';
import { MemoryReviewDb } from './memory-review-db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000000';
const TESTER_1 = '11111111-1111-4111-8111-111111111111';
const TESTER_2 = '22222222-2222-4222-8222-222222222222';
const PRODUCT_1 = '33333333-3333-4333-8333-333333333333';
const PRODUCT_2 = '33333333-3333-4333-8333-444444444444';
const CAT_AROMA = '44444444-4444-4444-8444-444444444444';
const CAT_EFFECT = '55555555-5555-4555-8555-555555555555';

const users = new Map<string, {
  id: string;
  role: Role;
  accountStatus: AccountStatus;
  testerStatus: TesterStatus;
  reviewApprovalEnabled: boolean;
}>();

function mockUser(
  id: string,
  flags: { role?: Role; testerStatus?: TesterStatus; reviewApprovalEnabled?: boolean },
) {
  users.set(id, {
    id,
    role: flags.role ?? Role.CREATOR,
    accountStatus: AccountStatus.ACTIVE,
    testerStatus: flags.testerStatus ?? TesterStatus.VERIFIED,
    reviewApprovalEnabled: flags.reviewApprovalEnabled ?? false,
  });
}

function video(testerId: string): string {
  return buildReviewObjectKey({
    testerId,
    contentType: 'video/mp4',
    objectId: randomUUID(),
  });
}

function seed(store: MemoryReviewDb): void {
  store.addProduct({
    productId: PRODUCT_1,
    name: 'Blue Dream',
    brandName: 'Pacific Gold',
    productTypeId: 'flower',
    productTypeName: 'Flower',
    productTypeSlug: 'flower',
  });
  store.addProduct({
    productId: PRODUCT_2,
    name: 'Gelato 33',
    brandName: 'Sherbinski',
    productTypeId: 'flower',
    productTypeName: 'Flower',
    productTypeSlug: 'flower',
  });
  store.addCategory({
    id: CAT_AROMA,
    name: 'Aroma',
    slug: 'aroma',
    defaultWeight: 1,
    isActive: true,
    sortOrder: 1,
  });
  store.addCategory({
    id: CAT_EFFECT,
    name: 'Effect',
    slug: 'effect',
    defaultWeight: 1,
    isActive: true,
    sortOrder: 2,
  });
}

describe('One Toke Admin Management Dashboard (Phase 6)', () => {
  const original = UserRepository.findReviewCapability;
  let store: MemoryReviewDb;

  before(() => {
    store = new MemoryReviewDb();
    seed(store);
    setProductReviewDb(store);
    mockUser(TESTER_1, { testerStatus: TesterStatus.VERIFIED });
    mockUser(TESTER_2, { testerStatus: TesterStatus.VERIFIED });
    mockUser(ADMIN_ID, { role: Role.ADMIN, reviewApprovalEnabled: true });
    UserRepository.findReviewCapability = async (id: string) => users.get(id) ?? null;
  });

  after(() => {
    setProductReviewDb(null);
    UserRepository.findReviewCapability = original;
  });

  it('lists all reviews across all statuses with pagination and filtering for admin', async () => {
    // 1. Create a draft
    const draft = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_1,
      videoObjectKey: video(TESTER_1),
      videoUrl: 'https://cdn.example.com/draft.mp4',
      durationSeconds: 30,
      dispensaryName: 'Apothecary North',
      city: 'Portland',
      state: 'OR',
      scores: [
        { categoryId: CAT_AROMA, score: 8 },
        { categoryId: CAT_EFFECT, score: 9 },
      ],
    });

    // 2. Create and submit another review
    const submitted = await ProductReviewRepository.createDraft({
      productId: PRODUCT_2,
      testerId: TESTER_2,
      videoObjectKey: video(TESTER_2),
      videoUrl: 'https://cdn.example.com/sub.mp4',
      durationSeconds: 45,
      dispensaryName: 'Cannabis Express',
      city: 'Seattle',
      state: 'WA',
    });
    await ProductReviewRepository.replaceCategoryScores(submitted.id, [
      { categoryId: CAT_AROMA, score: 7, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 8, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(submitted.id, TESTER_2);

    // Query all reviews
    const all = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
    });
    assert.ok(all.total >= 2);
    assert.ok(all.rows.some((r) => r.id === draft.id && r.status === ReviewStatus.DRAFT));
    assert.ok(all.rows.some((r) => r.id === submitted.id && r.status === ReviewStatus.SUBMITTED));

    // Filter by status SUBMITTED
    const onlySubmitted = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      status: ReviewStatus.SUBMITTED,
    });
    assert.ok(onlySubmitted.rows.every((r) => r.status === ReviewStatus.SUBMITTED));
    assert.ok(onlySubmitted.rows.some((r) => r.id === submitted.id));

    // Filter by testerId
    const onlyTester1 = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      testerId: TESTER_1,
    });
    assert.ok(onlyTester1.rows.every((r) => r.testerId === TESTER_1));

    // Filter by search
    const searched = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      search: 'Sherbinski',
    });
    assert.ok(searched.rows.some((r) => r.id === submitted.id));
  });

  it('rejects a submitted review with mandatory reason and transitions status to REJECTED', async () => {
    const rev = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_1,
      videoObjectKey: video(TESTER_1),
      videoUrl: 'https://cdn.example.com/to-reject.mp4',
      durationSeconds: 30,
      dispensaryName: 'Herbal Remedies',
    });
    await ProductReviewRepository.replaceCategoryScores(rev.id, [
      { categoryId: CAT_AROMA, score: 6, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 7, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(rev.id, TESTER_1);

    const rejected = await ProductReviewLifecycleService.rejectReview(
      rev.id,
      ADMIN_ID,
      'Video quality is degraded and lacks required dispensary receipt verification'
    );

    assert.equal(rejected.status, ReviewStatus.REJECTED);
    assert.equal(
      rejected.rejectionReason,
      'Video quality is degraded and lacks required dispensary receipt verification'
    );

    // Verify it is listed under REJECTED
    const list = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      status: ReviewStatus.REJECTED,
    });
    assert.ok(list.rows.some((r) => r.id === rev.id));
  });

  it('disqualifies a published review with mandatory reason and removes it from published status', async () => {
    const rev = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_2,
      videoObjectKey: video(TESTER_2),
      videoUrl: 'https://cdn.example.com/to-publish.mp4',
      durationSeconds: 40,
      dispensaryName: 'Organic Greens',
    });
    await ProductReviewRepository.replaceCategoryScores(rev.id, [
      { categoryId: CAT_AROMA, score: 9, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 9, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(rev.id, TESTER_2);
    await ProductReviewLifecycleService.approveAndPublishReview(rev.id, ADMIN_ID);

    // Now disqualify
    const disqualified = await ProductReviewLifecycleService.disqualifyReview(
      rev.id,
      ADMIN_ID,
      'Product recalled by manufacturer due to testing discrepancy'
    );

    assert.equal(disqualified.status, ReviewStatus.DISQUALIFIED);
    assert.equal(
      disqualified.rejectionReason,
      'Product recalled by manufacturer due to testing discrepancy'
    );

    // Confirm it is no longer returned in published query
    const published = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      status: ReviewStatus.PUBLISHED,
    });
    assert.ok(!published.rows.some((r) => r.id === rev.id));

    // Confirm it is returned in DISQUALIFIED query
    const disqList = await ProductReviewRepository.listAdminReviewsPage({
      skip: 0,
      take: 10,
      status: ReviewStatus.DISQUALIFIED,
    });
    assert.ok(disqList.rows.some((r) => r.id === rev.id));
  });

  it('rejects non-submitted reviews with error and requires non-empty reason', async () => {
    const draft = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_1,
      videoObjectKey: video(TESTER_1),
      videoUrl: 'https://cdn.example.com/draft2.mp4',
      durationSeconds: 25,
      dispensaryName: 'Pure Green',
    });

    // Cannot reject a draft
    await assert.rejects(
      async () => {
        await ProductReviewLifecycleService.rejectReview(draft.id, ADMIN_ID, 'Cannot reject draft');
      },
      { message: /transition/i }
    );

    // Reason cannot be empty
    await assert.rejects(
      async () => {
        await ProductReviewLifecycleService.rejectReview(draft.id, ADMIN_ID, '   ');
      },
      { message: /reason/i }
    );
  });
});
