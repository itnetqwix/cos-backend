import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccountStatus, ReviewStatus, Role } from '@prisma/client';
import { ProductReviewRepository, setProductReviewDb } from '../../src/repositories/product-review.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import {
  approveReview,
  disqualifyReview,
  handlePublishedEdit,
  ProductReviewLifecycleService,
  publishReview,
  rejectReview,
  requestChanges,
  submitDraft,
} from '../../src/services/product-review-lifecycle.service.js';
import { buildReviewObjectKey } from '../../src/services/storage.service.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/utils/response.js';
import { MemoryReviewDb } from './memory-review-db.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const APPROVER = '88888888-8888-4888-8888-888888888888';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const OTHER_PRODUCT = '99999999-9999-4999-8999-999999999999';
const SMELL = '55555555-5555-4555-8555-555555555555';
const TASTE = '66666666-6666-4666-8666-666666666666';

const users = new Map<string, {
  id: string;
  role: Role;
  accountStatus: AccountStatus;
  testerEnabled: boolean;
  reviewApprovalEnabled: boolean;
}>();

function actor(
  id: string,
  flags: { role?: Role; testerEnabled?: boolean; reviewApprovalEnabled?: boolean; accountStatus?: AccountStatus },
) {
  users.set(id, {
    id,
    role: flags.role ?? Role.CREATOR,
    accountStatus: flags.accountStatus ?? AccountStatus.ACTIVE,
    testerEnabled: flags.testerEnabled ?? false,
    reviewApprovalEnabled: flags.reviewApprovalEnabled ?? false,
  });
}

async function draft(notes = 'Solid nose'): Promise<string> {
  const created = await ProductReviewRepository.createDraft({
    productId: PRODUCT,
    testerId: TESTER,
    videoUrl: 'https://example.com/review.mp4',
    videoObjectKey: buildReviewObjectKey({
      testerId: TESTER,
      contentType: 'video/mp4',
      objectId: randomUUID(),
    }),
    durationSeconds: 15,
    city: 'Las Vegas',
    state: 'NV',
    dispensaryName: 'Planet 13',
    reviewNotes: notes,
  });
  await ProductReviewRepository.updateDraft(created.id, TESTER, {
    categoryScores: [
      { categoryId: SMELL, score: 8, weightApplied: 0 },
      { categoryId: TASTE, score: 6, weightApplied: 0 },
    ],
  });
  return created.id;
}

describe('product review lifecycle', { concurrency: 1 }, () => {
  const original = UserRepository.findReviewCapability;
  let store: MemoryReviewDb;

  before(() => {
    store = new MemoryReviewDb();
    store.addProduct({
      productId: PRODUCT,
      name: 'Gelato 41',
      brandName: 'Cookies',
      productTypeId: 'flower',
      productTypeName: 'Flower',
      productTypeSlug: 'flower',
    });
    store.addProduct({
      productId: OTHER_PRODUCT,
      name: 'Blue Dream',
      brandName: 'Cookies',
      productTypeId: 'flower',
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
      defaultWeight: 3,
      isActive: true,
      sortOrder: 2,
    });
    setProductReviewDb(store);
    actor(TESTER, { testerEnabled: true });
    actor(OTHER, { testerEnabled: true });
    actor(APPROVER, { reviewApprovalEnabled: true });
    UserRepository.findReviewCapability = async (id: string) => users.get(id) ?? null;
  });

  after(() => {
    setProductReviewDb(null);
    UserRepository.findReviewCapability = original;
  });

  it('allows only the documented transitions', () => {
    const allowed: Array<[ReviewStatus, ReviewStatus]> = [
      [ReviewStatus.DRAFT, ReviewStatus.SUBMITTED],
      [ReviewStatus.SUBMITTED, ReviewStatus.CHANGES_REQUESTED],
      [ReviewStatus.CHANGES_REQUESTED, ReviewStatus.SUBMITTED],
      [ReviewStatus.SUBMITTED, ReviewStatus.APPROVED],
      [ReviewStatus.APPROVED, ReviewStatus.PUBLISHED],
      [ReviewStatus.SUBMITTED, ReviewStatus.REJECTED],
      [ReviewStatus.APPROVED, ReviewStatus.DISQUALIFIED],
      [ReviewStatus.PUBLISHED, ReviewStatus.DISQUALIFIED],
      [ReviewStatus.PUBLISHED, ReviewStatus.SUBMITTED],
    ];
    for (const [from, to] of allowed) {
      assert.doesNotThrow(() => ProductReviewLifecycleService.assertReviewTransition(from, to));
    }
    const statuses = Object.values(ReviewStatus);
    for (const from of statuses) {
      for (const to of statuses) {
        if (allowed.some(([left, right]) => left === from && right === to)) continue;
        assert.throws(
          () => ProductReviewLifecycleService.assertReviewTransition(from, to),
          (error: unknown) =>
            error instanceof ConflictError &&
            error.statusCode === 409 &&
            error.message === `Invalid review status transition from ${from} to ${to}`,
        );
      }
    }
  });

  it('submits only for the owner when scores, weights, and video are valid', async () => {
    const id = await draft();
    await assert.rejects(() => submitDraft(id, OTHER), ForbiddenError);
    actor(TESTER, { testerEnabled: false });
    await assert.rejects(() => submitDraft(id, TESTER), ForbiddenError);
    actor(TESTER, { testerEnabled: true });
    const bare = await ProductReviewRepository.createDraft({
      productId: PRODUCT,
      testerId: TESTER,
      videoUrl: 'https://example.com/empty.mp4',
      videoObjectKey: buildReviewObjectKey({
        testerId: TESTER,
        contentType: 'video/mp4',
        objectId: randomUUID(),
      }),
      durationSeconds: 10,
    });
    await assert.rejects(() => submitDraft(bare.id, TESTER), ValidationError);

    const submitted = await submitDraft(id, TESTER);
    assert.equal(submitted.status, ReviewStatus.SUBMITTED);
    assert.equal(submitted.overallScore, 6.5);
    assert.equal(submitted.weightsSnapshot.find((entry) => entry.categoryId === TASTE)?.weight, 3);
    await assert.rejects(() => submitDraft(id, TESTER), ConflictError);
  });

  it('requires notes for changes and keeps approval separate from publication', async () => {
    const id = await draft();
    await submitDraft(id, TESTER);
    await assert.rejects(() => requestChanges(id, APPROVER, '   '), ValidationError);
    await assert.rejects(() => requestChanges(id, TESTER, 'Fix the notes'), ForbiddenError);
    const changes = await requestChanges(id, APPROVER, ' Fix the notes ');
    assert.equal(changes.status, ReviewStatus.CHANGES_REQUESTED);
    assert.equal(changes.changeRequestNotes, 'Fix the notes');
    const resubmitted = await submitDraft(id, TESTER);
    assert.equal(resubmitted.status, ReviewStatus.SUBMITTED);
    assert.equal(resubmitted.changeRequestNotes, null);

    await assert.rejects(() => publishReview(id, APPROVER), ConflictError);
    const approved = await approveReview(id, APPROVER);
    assert.equal(approved.status, ReviewStatus.APPROVED);
    assert.equal(approved.approvedById, APPROVER);
    assert.equal(approved.publishedAt, null);
    assert.equal(approved.publishedRevisionId, null);
    const published = await publishReview(id, APPROVER);
    assert.equal(published.status, ReviewStatus.PUBLISHED);
    assert.ok(published.publishedRevisionId);
    assert.equal((await ProductReviewRepository.listPublishedReviews()).some((row) => row.reviewId === id), true);

    const combinedId = await draft();
    await assert.rejects(
      () => ProductReviewLifecycleService.approveAndPublishReview(combinedId, APPROVER),
      ConflictError,
    );
    await submitDraft(combinedId, TESTER);
    const combined = await ProductReviewLifecycleService.approveAndPublishReview(combinedId, APPROVER);
    assert.equal(combined.status, ReviewStatus.PUBLISHED);
    assert.equal(combined.approvedById, APPROVER);
    assert.ok(combined.publishedRevisionId);
  });

  it('keeps the published revision during a material edit and moves it for a typo', async () => {
    const id = await draft('Original claim');
    await submitDraft(id, TESTER);
    await approveReview(id, APPROVER);
    const published = await publishReview(id, APPROVER);
    const publishedRevisionId = published.publishedRevisionId;
    assert.ok(publishedRevisionId);

    const edited = await handlePublishedEdit(id, TESTER, {
      reviewNotes: 'Changed claim about the high',
      categoryScores: [
        { categoryId: SMELL, score: 10 },
        { categoryId: TASTE, score: 10 },
      ],
    });
    assert.equal(edited.status, ReviewStatus.SUBMITTED);
    assert.equal(edited.publishedRevisionId, publishedRevisionId);
    assert.equal(edited.overallScore, 10);
    const publicRows = await ProductReviewRepository.listPublishedReviews({ productId: PRODUCT });
    const visible = publicRows.find((row) => row.reviewId === id);
    assert.equal(visible?.publishedRevisionId, publishedRevisionId);
    assert.equal(visible?.reviewNotes, 'Original claim');
    assert.equal(visible?.overallScore, 6.5);
    const revisions = await ProductReviewRepository.listRevisions(id);
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].overallScore, 6.5);
    assert.equal(revisions[1].changeReason, 'material edit');

    await approveReview(id, APPROVER);
    const republished = await publishReview(id, APPROVER);
    assert.equal(republished.status, ReviewStatus.PUBLISHED);
    assert.notEqual(republished.publishedRevisionId, publishedRevisionId);
    const after = await ProductReviewRepository.listPublishedReviews({ productId: PRODUCT });
    assert.equal(after.find((row) => row.reviewId === id)?.overallScore, 10);

    const typo = await handlePublishedEdit(id, TESTER, { dispensaryName: 'Planet13' });
    assert.equal(typo.status, ReviewStatus.PUBLISHED);
    assert.notEqual(typo.publishedRevisionId, republished.publishedRevisionId);
    const publicTypo = (await ProductReviewRepository.listPublishedReviews({ productId: PRODUCT })).find(
      (row) => row.reviewId === id,
    );
    assert.equal(publicTypo?.dispensaryName, 'Planet13');
    assert.equal(publicTypo?.publishedRevisionId, typo.publishedRevisionId);
    const kept = await ProductReviewRepository.listRevisions(id);
    assert.equal(kept.some((revision) => revision.id === publishedRevisionId), true);

    await assert.rejects(
      () => handlePublishedEdit(id, TESTER, { overallScore: 1 }),
      ValidationError,
    );
    await handlePublishedEdit(id, TESTER, { productId: OTHER_PRODUCT });
    const during = await ProductReviewRepository.listPublishedReviews({ productId: PRODUCT });
    assert.equal(during.find((row) => row.reviewId === id)?.productId, PRODUCT);
  });

  it('rejects and disqualifies without leaving the review public', async () => {
    const rejectedId = await draft();
    await submitDraft(rejectedId, TESTER);
    await assert.rejects(() => rejectReview(rejectedId, APPROVER, ' '), ValidationError);
    const rejected = await rejectReview(rejectedId, APPROVER, 'Wrong product');
    assert.equal(rejected.status, ReviewStatus.REJECTED);
    assert.equal(
      (await ProductReviewRepository.listPublishedReviews()).some((row) => row.reviewId === rejectedId),
      false,
    );

    const id = await draft();
    await submitDraft(id, TESTER);
    await approveReview(id, APPROVER);
    await publishReview(id, APPROVER);
    const removed = await disqualifyReview(id, APPROVER, 'Sample fraud');
    assert.equal(removed.status, ReviewStatus.DISQUALIFIED);
    assert.equal(removed.rejectionReason, 'Sample fraud');
    assert.equal(
      (await ProductReviewRepository.listPublishedReviews()).some((row) => row.reviewId === id),
      false,
    );
    await assert.rejects(() => publishReview(id, APPROVER), ConflictError);
  });

  it('lets one of two overlapping decisions win', async () => {
    const id = await draft();
    await submitDraft(id, TESTER);
    const results = await Promise.allSettled([
      approveReview(id, APPROVER),
      requestChanges(id, APPROVER, 'Need a clearer ending'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].status === 'rejected' && rejected[0].reason instanceof ConflictError);
    const row = await ProductReviewRepository.findById(id);
    assert.ok(row);
    assert.ok(row.status === ReviewStatus.APPROVED || row.status === ReviewStatus.CHANGES_REQUESTED);
  });
});
