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
import { viewPublished } from '../../src/controllers/product-review.controller.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000000';
const TESTER_A = '11111111-1111-4111-8111-111111111111';
const TESTER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_1 = '33333333-3333-4333-8333-333333333333';
const PRODUCT_2 = '33333333-3333-4333-8333-444444444444';
const CAT_AROMA = '44444444-4444-4444-8444-444444444444';
const CAT_EFFECT = '55555555-5555-4555-8555-555555555555';

const users = new Map<string, {
  id: string;
  name: string;
  role: Role;
  accountStatus: AccountStatus;
  testerStatus: TesterStatus;
  reviewApprovalEnabled: boolean;
  testerBio: string | null;
}>();

function mockUser(
  id: string,
  name: string,
  flags: { role?: Role; testerStatus?: TesterStatus; reviewApprovalEnabled?: boolean; testerBio?: string },
) {
  users.set(id, {
    id,
    name,
    role: flags.role ?? Role.CREATOR,
    accountStatus: AccountStatus.ACTIVE,
    testerStatus: flags.testerStatus ?? TesterStatus.VERIFIED,
    reviewApprovalEnabled: flags.reviewApprovalEnabled ?? false,
    testerBio: flags.testerBio ?? 'Accredited Sommelier',
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
    name: 'OG Kush',
    brandName: 'Emerald Triangle',
    productTypeId: 'flower',
    productTypeName: 'Flower',
    productTypeSlug: 'flower',
  });
  store.addProduct({
    productId: PRODUCT_2,
    name: 'Strawberry Cough',
    brandName: 'Dab Daddy',
    productTypeId: 'concentrate',
    productTypeName: 'Concentrate',
    productTypeSlug: 'concentrate',
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

describe('Public Review Discovery & Data Integrity (Phase 7)', () => {
  const original = UserRepository.findReviewCapability;
  let store: MemoryReviewDb;
  let pubRev1Id: string;
  let pubRev2Id: string;
  let draftRevId: string;

  before(async () => {
    store = new MemoryReviewDb();
    seed(store);
    setProductReviewDb(store);

    mockUser(TESTER_A, 'Alice Green', { testerStatus: TesterStatus.VERIFIED, testerBio: 'Cannabis Connoisseur' });
    mockUser(TESTER_B, 'Bob Stone', { testerStatus: TesterStatus.VERIFIED, testerBio: 'Hash Reviewer' });
    mockUser(ADMIN_ID, 'Admin Phil', { role: Role.ADMIN, reviewApprovalEnabled: true });
    UserRepository.findReviewCapability = async (id: string) => users.get(id) ?? null;

    // Review 1: Published, OG Kush, Tester A, Overall Score 9.0
    const rev1 = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_A,
      videoObjectKey: video(TESTER_A),
      videoUrl: 'https://cdn.example.com/pub1.mp4',
      durationSeconds: 30,
      dispensaryName: 'Green House Denver',
      city: 'Denver',
      state: 'CO',
      country: 'USA',
      reviewNotes: 'Exceptional aroma and clean finish.',
    });
    await ProductReviewRepository.replaceCategoryScores(rev1.id, [
      { categoryId: CAT_AROMA, score: 9, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 9, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(rev1.id, TESTER_A);
    await ProductReviewLifecycleService.approveAndPublishReview(rev1.id, ADMIN_ID);
    pubRev1Id = rev1.id;

    // Review 2: Published, Strawberry Cough, Tester B, Overall Score 7.5
    const rev2 = await ProductReviewRepository.createDraft({
      productId: PRODUCT_2,
      testerId: TESTER_B,
      videoObjectKey: video(TESTER_B),
      videoUrl: 'https://cdn.example.com/pub2.mp4',
      durationSeconds: 40,
      dispensaryName: 'Pacific Collective',
      city: 'Portland',
      state: 'OR',
      country: 'USA',
      reviewNotes: 'Sweet berry flavor with moderate potency.',
    });
    await ProductReviewRepository.replaceCategoryScores(rev2.id, [
      { categoryId: CAT_AROMA, score: 8, weightApplied: 1 },
      { categoryId: CAT_EFFECT, score: 7, weightApplied: 1 },
    ]);
    await ProductReviewLifecycleService.submitDraft(rev2.id, TESTER_B);
    await ProductReviewLifecycleService.approveAndPublishReview(rev2.id, ADMIN_ID);
    pubRev2Id = rev2.id;

    // Review 3: Draft (NOT published)
    const rev3 = await ProductReviewRepository.createDraft({
      productId: PRODUCT_1,
      testerId: TESTER_A,
      videoObjectKey: video(TESTER_A),
      videoUrl: 'https://cdn.example.com/draft3.mp4',
      durationSeconds: 25,
      dispensaryName: 'Private Garden',
    });
    draftRevId = rev3.id;
  });

  after(() => {
    setProductReviewDb(null);
    UserRepository.findReviewCapability = original;
  });

  it('lists only published reviews and excludes drafts from public discovery', async () => {
    const page = await ProductReviewRepository.listPublicPage({
      skip: 0,
      take: 10,
    });

    assert.equal(page.total, 2);
    assert.ok(page.rows.some((r) => r.reviewId === pubRev1Id));
    assert.ok(page.rows.some((r) => r.reviewId === pubRev2Id));
    assert.ok(!page.rows.some((r) => r.reviewId === draftRevId));
  });

  it('filters public reviews by productTypeId and brandName', async () => {
    const flowerOnly = await ProductReviewRepository.listPublicPage({
      skip: 0,
      take: 10,
      productTypeId: 'flower',
    });
    assert.equal(flowerOnly.total, 1);
    assert.equal(flowerOnly.rows[0].reviewId, pubRev1Id);

    const dabDaddyOnly = await ProductReviewRepository.listPublicPage({
      skip: 0,
      take: 10,
      brandName: 'Dab Daddy',
    });
    assert.equal(dabDaddyOnly.total, 1);
    assert.equal(dabDaddyOnly.rows[0].reviewId, pubRev2Id);
  });

  it('searches public reviews by text across product name, dispensary, and review notes', async () => {
    const searchKush = await ProductReviewRepository.listPublicPage({
      skip: 0,
      take: 10,
      search: 'Kush',
    });
    assert.equal(searchKush.total, 1);
    assert.equal(searchKush.rows[0].reviewId, pubRev1Id);

    const searchPortland = await ProductReviewRepository.listPublicPage({
      skip: 0,
      take: 10,
      search: 'Portland',
    });
    assert.equal(searchPortland.total, 1);
    assert.equal(searchPortland.rows[0].reviewId, pubRev2Id);
  });

  it('findPublished returns public review with published revision snapshot and reviewer identity', async () => {
    const pub1 = await ProductReviewRepository.findPublished(pubRev1Id);
    assert.ok(pub1);
    assert.equal(pub1.reviewId, pubRev1Id);
    assert.equal(pub1.productSnapshot.name, 'OG Kush');
    assert.equal(pub1.overallScore, 9);
    assert.ok(pub1.tester);
    assert.equal(pub1.tester.id, TESTER_A);

    // Draft review returns null on public findPublished
    const draft = await ProductReviewRepository.findPublished(draftRevId);
    assert.equal(draft, null);
  });

  it('viewPublished serializer includes reviewer identity and omits private data', async () => {
    const pub = await ProductReviewRepository.findPublished(pubRev1Id);
    assert.ok(pub);

    const serialized = await viewPublished(pub);
    assert.equal(serialized.id, pubRev1Id);
    assert.equal(serialized.status, 'PUBLISHED');
    assert.ok(serialized.tester);
    assert.equal(serialized.tester.id, TESTER_A);

    // Must NOT contain sensitive applicant fields or emails
    const raw = serialized as Record<string, unknown>;
    assert.equal(raw.email, undefined);
    assert.equal(raw.passwordHash, undefined);
    assert.equal(raw.applicantNotes, undefined);
  });
});

