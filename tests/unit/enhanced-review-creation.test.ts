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
const TESTER_A = '11111111-1111-4111-8111-111111111111';
const TESTER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_1 = '33333333-3333-4333-8333-333333333333';
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
    name: 'Sour Diesel',
    brandName: 'Top Shelf',
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

describe('Enhanced Review Creation Workflow (Phase 5)', () => {
  const original = UserRepository.findReviewCapability;
  let store: MemoryReviewDb;

  before(() => {
    store = new MemoryReviewDb();
    seed(store);
    setProductReviewDb(store);
    mockUser(TESTER_A, { testerStatus: TesterStatus.VERIFIED });
    mockUser(TESTER_B, { testerStatus: TesterStatus.VERIFIED });
    mockUser(ADMIN_ID, { role: Role.ADMIN, reviewApprovalEnabled: true });
    UserRepository.findReviewCapability = async (id: string) => users.get(id) ?? null;
  });

  after(() => {
    setProductReviewDb(null);
    UserRepository.findReviewCapability = original;
  });

  it('creates draft with dispensaryAddress and attributes admin creator when created on behalf of tester', async () => {
    const videoKey = video(ADMIN_ID);
    const draft = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_A,
      createdByAdminId: ADMIN_ID,
      videoObjectKey: videoKey,
      videoUrl: `https://cdn.example.com/${videoKey}`,
      durationSeconds: 45,
      dispensaryName: 'Green Relief Dispensary',
      dispensaryAddress: '420 Herbal Way, Suite 10',
      city: 'Denver',
      state: 'CO',
      country: 'USA',
      reviewNotes: 'Created by admin on behalf of verified reviewer',
    });

    assert.equal(draft.testerId, TESTER_A);
    assert.equal(draft.createdByAdminId, ADMIN_ID);
    assert.equal(draft.dispensaryName, 'Green Relief Dispensary');
    assert.equal(draft.dispensaryAddress, '420 Herbal Way, Suite 10');
    assert.equal(draft.status, ReviewStatus.DRAFT);
  });

  it('allows owner and admin to retrieve review via findMineById, but blocks other testers', async () => {
    const videoKey = video(TESTER_A);
    const draft = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_A,
      videoObjectKey: videoKey,
      videoUrl: `https://cdn.example.com/${videoKey}`,
      durationSeconds: 30,
      dispensaryName: 'Apothecary',
      dispensaryAddress: '100 Main St',
    });

    // Owner can find it
    const owned = await ProductReviewRepository.findMineById(draft.id, TESTER_A, false);
    assert.ok(owned);
    assert.equal(owned.id, draft.id);

    // Another tester cannot find it
    const other = await ProductReviewRepository.findMineById(draft.id, TESTER_B, false);
    assert.equal(other, null);

    // Admin can find it
    const asAdmin = await ProductReviewRepository.findMineById(draft.id, ADMIN_ID, true);
    assert.ok(asAdmin);
    assert.equal(asAdmin.id, draft.id);
  });

  it('filters tester reviews by status in listMinePage for dashboard tabs', async () => {
    const videoKey1 = video(TESTER_B);
    const draft1 = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_B,
      videoObjectKey: videoKey1,
      videoUrl: `https://cdn.example.com/${videoKey1}`,
      durationSeconds: 35,
    });

    const videoKey2 = video(TESTER_B);
    const draft2 = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_B,
      videoObjectKey: videoKey2,
      videoUrl: `https://cdn.example.com/${videoKey2}`,
      durationSeconds: 40,
    });

    // Add required scores to draft2 and submit it
    await ProductReviewRepository.replaceCategoryScores(draft2.id, [
      { categoryId: CAT_AROMA, score: 9, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 8, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(draft2.id, TESTER_B);

    // List all
    const all = await ProductReviewRepository.listMinePage(TESTER_B, 0, 10);
    assert.equal(all.total, 2);

    // Filter by DRAFT
    const drafts = await ProductReviewRepository.listMinePage(TESTER_B, 0, 10, ReviewStatus.DRAFT);
    assert.equal(drafts.total, 1);
    assert.equal(drafts.rows[0].id, draft1.id);

    // Filter by SUBMITTED
    const submitted = await ProductReviewRepository.listMinePage(TESTER_B, 0, 10, ReviewStatus.SUBMITTED);
    assert.equal(submitted.total, 1);
    assert.equal(submitted.rows[0].id, draft2.id);
  });

  it('supports changes-requested -> edit & resubmission workflow preserving snapshots', async () => {
    const videoKey = video(TESTER_A);
    const draft = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_A,
      videoObjectKey: videoKey,
      videoUrl: `https://cdn.example.com/${videoKey}`,
      durationSeconds: 30,
      dispensaryAddress: 'Initial Address',
    });

    await ProductReviewRepository.replaceCategoryScores(draft.id, [
      { categoryId: CAT_AROMA, score: 7, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 8, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(draft.id, TESTER_A);

    // Admin requests changes
    const changesReq = await ProductReviewLifecycleService.requestChanges(
      draft.id,
      ADMIN_ID,
      'Please update dispensary location details and explain aroma more.',
    );
    assert.equal(changesReq.status, ReviewStatus.CHANGES_REQUESTED);
    assert.equal(changesReq.changeRequestNotes, 'Please update dispensary location details and explain aroma more.');

    // Author edits draft and updates dispensaryAddress
    const updated = await ProductReviewRepository.updateDraft(draft.id, TESTER_A, {
      dispensaryAddress: 'Updated 500 Broadway St',
      reviewNotes: 'Updated with detailed aroma profile.',
    });
    assert.equal(updated.dispensaryAddress, 'Updated 500 Broadway St');
    assert.equal(updated.reviewNotes, 'Updated with detailed aroma profile.');

    // Author resubmits
    const resubmitted = await ProductReviewLifecycleService.submitDraft(draft.id, TESTER_A);
    assert.equal(resubmitted.status, ReviewStatus.SUBMITTED);
    assert.equal(resubmitted.changeRequestNotes, null);

    // Approver approves and publishes review
    await ProductReviewLifecycleService.approveReview(draft.id, ADMIN_ID);
    const published = await ProductReviewLifecycleService.publishReview(draft.id, ADMIN_ID);
    assert.equal(published.status, ReviewStatus.PUBLISHED);

    // Verify revision was created with dispensaryAddress preserved
    const revisions = await ProductReviewRepository.listRevisions(draft.id);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].dispensaryAddress, 'Updated 500 Broadway St');
  });
});
