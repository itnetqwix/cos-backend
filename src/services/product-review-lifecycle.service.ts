import { AccountStatus, ReviewStatus, Role } from '@prisma/client';
import {
  ProductReviewRepository,
  type ReviewDb,
  type ReviewRow,
} from '../repositories/product-review.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import { CREATOR_BLOCKED_MESSAGE } from './creator-account.service.js';
import {
  calculateOverallScore,
  type CategoryScoreInput,
  type WeightedCategory,
} from './review-score.service.js';
import { parseReviewObjectKey, thumbnailKeyForReview } from './storage.service.js';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';

/**
 * One Toke review lifecycle (M02-P01-T04).
 *
 * Approval and publication are separate writes.
 * A material edit on a published review leaves `publishedRevisionId` on the
 * revision that was already public.
 */

const TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  DRAFT: [ReviewStatus.SUBMITTED],
  SUBMITTED: [
    ReviewStatus.CHANGES_REQUESTED,
    ReviewStatus.APPROVED,
    ReviewStatus.REJECTED,
  ],
  CHANGES_REQUESTED: [ReviewStatus.SUBMITTED],
  APPROVED: [ReviewStatus.PUBLISHED, ReviewStatus.DISQUALIFIED],
  PUBLISHED: [ReviewStatus.DISQUALIFIED, ReviewStatus.SUBMITTED],
  REJECTED: [],
  DISQUALIFIED: [],
};

const SIGNIFICANT_FIELDS = [
  'productId',
  'categoryScores',
  'overallScore',
  'videoObjectKey',
  'videoUrl',
  'thumbnailUrl',
  'durationSeconds',
  'reviewNotes',
] as const;

const MINOR_FIELDS = ['dispensaryName', 'city', 'state', 'country'] as const;

export interface PublishedReviewEdit {
  productId?: string;
  categoryScores?: CategoryScoreInput[];
  overallScore?: number;
  videoObjectKey?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  reviewNotes?: string | null;
  dispensaryName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export function assertReviewTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`Invalid review status transition from ${from} to ${to}`);
  }
}

function inTx<T>(
  tx: ReviewDb | undefined,
  fn: (store: ReviewDb) => Promise<T>,
): Promise<T> {
  if (tx) return fn(tx);
  return ProductReviewRepository.transaction(fn);
}

async function loadActor(userId: string) {
  const user = await UserRepository.findReviewCapability(userId);
  if (!user) throw new ForbiddenError('Forbidden: review capability is not enabled');
  if (user.role === Role.CREATOR && user.accountStatus === AccountStatus.BLOCKED) {
    throw new ForbiddenError(CREATOR_BLOCKED_MESSAGE);
  }
  return user;
}

async function assertTesterOwner(testerId: string, review: ReviewRow): Promise<void> {
  const user = await loadActor(testerId);
  if (user.role !== Role.ADMIN && !user.testerEnabled) {
    throw new ForbiddenError('Forbidden: Tester capability is not enabled');
  }
  if (review.testerId !== testerId) {
    throw new ForbiddenError('Forbidden: review is owned by another tester');
  }
}

async function assertApprover(approverId: string): Promise<void> {
  const user = await loadActor(approverId);
  if (user.role !== Role.ADMIN && !user.reviewApprovalEnabled) {
    throw new ForbiddenError('Forbidden: Review approval is not enabled');
  }
}

async function assertEditor(editorId: string, review: ReviewRow): Promise<void> {
  const user = await loadActor(editorId);
  const owner =
    review.testerId === editorId && (user.role === Role.ADMIN || user.testerEnabled);
  const approver = user.role === Role.ADMIN || user.reviewApprovalEnabled;
  if (!owner && !approver) {
    throw new ForbiddenError('Forbidden: You cannot edit this review');
  }
}

function assertVideo(
  review: Pick<
    ReviewRow,
    'testerId' | 'videoObjectKey' | 'videoUrl' | 'durationSeconds' | 'thumbnailUrl'
  >,
): void {
  const parsed = parseReviewObjectKey(review.videoObjectKey);
  if (!parsed || parsed.testerId.toLowerCase() !== review.testerId.toLowerCase()) {
    throw new ValidationError('Review video key is not valid for this tester');
  }
  if (!review.videoUrl.trim()) throw new ValidationError('Review video is required');
  if (
    !Number.isInteger(review.durationSeconds) ||
    review.durationSeconds < VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS ||
    review.durationSeconds > VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS
  ) {
    throw new ValidationError('Review video duration is invalid');
  }
  if (
    review.thumbnailUrl &&
    review.thumbnailUrl !== thumbnailKeyForReview(review.videoObjectKey)
  ) {
    throw new ValidationError('Review thumbnail does not match the video');
  }
}

function assertFrozenScore(review: ReviewRow): void {
  const categories: WeightedCategory[] = review.weightsSnapshot.map((entry) => ({
    id: entry.categoryId,
    name: entry.name,
    slug: entry.slug,
    weight: entry.weight,
    isActive: true,
  }));
  const result = calculateOverallScore(
    review.categoryScores.map((score) => ({
      categoryId: score.categoryId,
      score: score.score,
    })),
    categories,
  );
  if (result.overallScore !== review.overallScore) {
    throw new ValidationError('Overall score does not match the frozen category weights');
  }
  for (const score of review.categoryScores) {
    const frozen = review.weightsSnapshot.find(
      (entry) => entry.categoryId === score.categoryId,
    );
    if (!frozen || frozen.weight !== score.weightApplied) {
      throw new ValidationError(
        'Category score weight does not match the frozen snapshot',
      );
    }
  }
}

function requireText(value: string, message: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ValidationError(message);
  return value.trim();
}

function classifyEdit(edit: PublishedReviewEdit): 'significant' | 'minor' {
  const keys = (Object.keys(edit) as Array<keyof PublishedReviewEdit>).filter(
    (key) => edit[key] !== undefined,
  );
  if (keys.length === 0) throw new ValidationError('No review fields to update');
  const known = new Set<string>([...SIGNIFICANT_FIELDS, ...MINOR_FIELDS]);
  for (const key of keys) {
    if (!known.has(key)) throw new ValidationError(`Unknown review field: ${key}`);
  }
  if (keys.includes('overallScore') && !keys.includes('categoryScores')) {
    throw new ValidationError('Overall score is calculated from category scores');
  }
  return keys.some((key) => (SIGNIFICANT_FIELDS as readonly string[]).includes(key))
    ? 'significant'
    : 'minor';
}

async function requireReview(id: string, tx: ReviewDb): Promise<ReviewRow> {
  const review = await ProductReviewRepository.findById(id, tx);
  if (!review || review.deletedAt) throw new NotFoundError('Review not found');
  return review;
}

export class ProductReviewLifecycleService {
  static assertReviewTransition = assertReviewTransition;

  static async submitDraft(
    reviewId: string,
    testerId: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const existing = await ProductReviewRepository.findById(reviewId);
    if (!existing || existing.deletedAt) throw new NotFoundError('Review not found');
    await assertTesterOwner(testerId, existing);
    assertReviewTransition(existing.status, ReviewStatus.SUBMITTED);

    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.SUBMITTED);
      const categories = await ProductReviewRepository.listActiveCategories(store);
      const result = calculateOverallScore(
        review.categoryScores.map((score) => ({
          categoryId: score.categoryId,
          score: score.score,
        })),
        categories.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          weight: category.defaultWeight,
          isActive: category.isActive,
        })),
      );
      await ProductReviewRepository.replaceCategoryScores(
        reviewId,
        result.weightsSnapshot.map((entry) => {
          const score = review.categoryScores.find(
            (row) => row.categoryId === entry.categoryId,
          );
          return {
            categoryId: entry.categoryId,
            score: score?.score ?? 0,
            weightApplied: entry.weight,
          };
        }),
        store,
      );
      await ProductReviewRepository.saveScore(
        reviewId,
        result.overallScore,
        result.weightsSnapshot,
        store,
      );
      const scored = await requireReview(reviewId, store);
      assertVideo(scored);
      assertFrozenScore(scored);
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: scored.status, updatedAt: scored.updatedAt },
        { status: ReviewStatus.SUBMITTED, changeRequestNotes: null },
        store,
      );
    });
  }

  static async requestChanges(
    reviewId: string,
    approverId: string,
    notes: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const note = requireText(notes, 'Changes-requested notes are required');
    await assertApprover(approverId);
    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.CHANGES_REQUESTED);
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        { status: ReviewStatus.CHANGES_REQUESTED, changeRequestNotes: note },
        store,
      );
    });
  }

  static async approveReview(
    reviewId: string,
    approverId: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    await assertApprover(approverId);
    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.APPROVED);
      assertVideo(review);
      assertFrozenScore(review);
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        {
          status: ReviewStatus.APPROVED,
          approvedById: approverId,
          approvedAt: new Date(),
        },
        store,
      );
    });
  }

  static async publishReview(
    reviewId: string,
    approverId: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    await assertApprover(approverId);
    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.PUBLISHED);
      if (review.status !== ReviewStatus.APPROVED) {
        throw new ConflictError('A review cannot be published without an approved state');
      }
      assertVideo(review);
      assertFrozenScore(review);
      const revision = await ProductReviewRepository.createRevisionSnapshot(
        reviewId,
        store,
        {
          changedById: approverId,
          changeReason: 'publish',
        },
      );
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        {
          status: ReviewStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedRevisionId: revision.id,
        },
        store,
      );
    });
  }

  static async approveAndPublishReview(
    reviewId: string,
    approverId: string,
  ): Promise<ReviewRow> {
    return ProductReviewRepository.transaction(async (tx) => {
      await ProductReviewLifecycleService.approveReview(reviewId, approverId, tx);
      return ProductReviewLifecycleService.publishReview(reviewId, approverId, tx);
    });
  }

  static async rejectReview(
    reviewId: string,
    approverId: string,
    reason: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const rejectionReason = requireText(reason, 'Rejection reason is required');
    await assertApprover(approverId);
    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.REJECTED);
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        { status: ReviewStatus.REJECTED, rejectionReason },
        store,
      );
    });
  }

  static async disqualifyReview(
    reviewId: string,
    approverId: string,
    reason: string,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const rejectionReason = requireText(reason, 'Disqualification reason is required');
    await assertApprover(approverId);
    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      assertReviewTransition(review.status, ReviewStatus.DISQUALIFIED);
      return ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        { status: ReviewStatus.DISQUALIFIED, rejectionReason },
        store,
      );
    });
  }

  static async handlePublishedEdit(
    reviewId: string,
    editorId: string,
    changedFields: PublishedReviewEdit,
    tx?: ReviewDb,
  ): Promise<ReviewRow> {
    const kind = classifyEdit(changedFields);
    const existing = await ProductReviewRepository.findById(reviewId);
    if (!existing || existing.deletedAt) throw new NotFoundError('Review not found');
    await assertEditor(editorId, existing);

    return inTx(tx, async (store) => {
      const review = await requireReview(reviewId, store);
      const republishPending =
        review.publishedRevisionId !== null && review.status !== ReviewStatus.PUBLISHED;
      if (review.status !== ReviewStatus.PUBLISHED && !republishPending) {
        throw new ConflictError(
          `Invalid review status transition from ${review.status} to SUBMITTED`,
        );
      }
      if (
        review.status === ReviewStatus.REJECTED ||
        review.status === ReviewStatus.DISQUALIFIED
      ) {
        throw new ConflictError(
          `Invalid review status transition from ${review.status} to SUBMITTED`,
        );
      }

      let overallScore = review.overallScore;
      let weightsSnapshot = review.weightsSnapshot;
      if (changedFields.categoryScores) {
        const result = calculateOverallScore(
          changedFields.categoryScores,
          review.weightsSnapshot.map((entry) => ({
            id: entry.categoryId,
            name: entry.name,
            slug: entry.slug,
            weight: entry.weight,
            isActive: true,
          })),
        );
        overallScore = result.overallScore;
        weightsSnapshot = result.weightsSnapshot;
        await ProductReviewRepository.replaceCategoryScores(
          reviewId,
          result.weightsSnapshot.map((entry) => ({
            categoryId: entry.categoryId,
            score: changedFields.categoryScores!.find(
              (score) => score.categoryId === entry.categoryId,
            )!.score,
            weightApplied: entry.weight,
          })),
          store,
        );
      }

      if (changedFields.productId) {
        const product = await store.findProduct(changedFields.productId);
        if (!product) throw new NotFoundError('Product not found');
      }

      const video = {
        testerId: review.testerId,
        videoObjectKey: changedFields.videoObjectKey ?? review.videoObjectKey,
        videoUrl: changedFields.videoUrl ?? review.videoUrl,
        durationSeconds: changedFields.durationSeconds ?? review.durationSeconds,
        thumbnailUrl:
          changedFields.thumbnailUrl === undefined
            ? review.thumbnailUrl
            : changedFields.thumbnailUrl,
      };
      assertVideo(video);

      const significant = kind === 'significant';
      const leavePublic =
        significant &&
        (review.status === ReviewStatus.PUBLISHED ||
          review.status === ReviewStatus.APPROVED);
      await ProductReviewRepository.saveIfCurrent(
        reviewId,
        { status: review.status, updatedAt: review.updatedAt },
        {
          productId: changedFields.productId,
          videoObjectKey: changedFields.videoObjectKey,
          videoUrl: changedFields.videoUrl,
          thumbnailUrl: changedFields.thumbnailUrl,
          durationSeconds: changedFields.durationSeconds,
          reviewNotes: changedFields.reviewNotes,
          dispensaryName: changedFields.dispensaryName,
          city: changedFields.city,
          state: changedFields.state,
          country: changedFields.country,
          overallScore,
          weightsSnapshot,
          ...(leavePublic
            ? {
                status: ReviewStatus.SUBMITTED,
                approvedById: null,
                approvedAt: null,
              }
            : {}),
        },
        store,
      );
      const revision = await ProductReviewRepository.createRevisionSnapshot(
        reviewId,
        store,
        {
          changedById: editorId,
          changeReason: significant ? 'material edit' : 'minor edit',
        },
      );
      if (!significant && review.status === ReviewStatus.PUBLISHED) {
        const pending = await requireReview(reviewId, store);
        return ProductReviewRepository.saveIfCurrent(
          reviewId,
          { status: pending.status, updatedAt: pending.updatedAt },
          { publishedRevisionId: revision.id },
          store,
        );
      }
      return requireReview(reviewId, store);
    });
  }
}

export const submitDraft = ProductReviewLifecycleService.submitDraft.bind(
  ProductReviewLifecycleService,
);
export const requestChanges = ProductReviewLifecycleService.requestChanges.bind(
  ProductReviewLifecycleService,
);
export const approveReview = ProductReviewLifecycleService.approveReview.bind(
  ProductReviewLifecycleService,
);
export const publishReview = ProductReviewLifecycleService.publishReview.bind(
  ProductReviewLifecycleService,
);
export const approveAndPublishReview =
  ProductReviewLifecycleService.approveAndPublishReview.bind(
    ProductReviewLifecycleService,
  );
export const rejectReview = ProductReviewLifecycleService.rejectReview.bind(
  ProductReviewLifecycleService,
);
export const disqualifyReview = ProductReviewLifecycleService.disqualifyReview.bind(
  ProductReviewLifecycleService,
);
export const handlePublishedEdit = ProductReviewLifecycleService.handlePublishedEdit.bind(
  ProductReviewLifecycleService,
);
