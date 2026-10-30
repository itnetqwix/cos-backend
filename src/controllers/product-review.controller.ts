import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  ProductReviewRepository,
  type PublishedReviewRecord,
  type ReviewRow,
} from '../repositories/product-review.repository.js';
import {
  createReviewDraftSchema,
  presignReviewSchema,
  reviewIdParamSchema,
  reviewListQuerySchema,
  submitReviewSchema,
  updateReviewDraftSchema,
  type CategoryScoreInput,
} from '../schemas/product-review.schema.js';
import { ProductReviewLifecycleService } from '../services/product-review-lifecycle.service.js';
import {
  buildReviewObjectKey,
  getStorageService,
  parseReviewObjectKey,
  playbackUrlForSubmission,
  resolveThumbnailUrl,
  THUMBNAIL_CONTENT_TYPE,
  thumbnailKeyForReview,
} from '../services/storage.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/response.js';
import { buildPaginatedResult } from '../utils/pagination.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function testerId(request: FastifyRequest): string {
  return request.user.id;
}

async function weightsFor(scores: CategoryScoreInput[]) {
  const categories = await ProductReviewRepository.listActiveCategories();
  const byId = new Map(categories.map((category) => [category.id, category]));
  return scores.map((score) => {
    const category = byId.get(score.categoryId);
    if (!category)
      throw new ValidationError('Score does not match a required active category');
    return {
      categoryId: score.categoryId,
      score: score.score,
      weightApplied: category.defaultWeight,
    };
  });
}

async function viewReview(review: ReviewRow, audience: 'public' | 'restricted') {
  return {
    id: review.id,
    productId: review.productId,
    product: review.product,
    testerId: review.testerId,
    status: review.status,
    dispensaryName: review.dispensaryName,
    city: review.city,
    state: review.state,
    country: review.country,
    videoUrl: await playbackUrlForSubmission(review.videoObjectKey, review.videoUrl, {
      audience,
    }),
    videoObjectKey: review.videoObjectKey,
    thumbnailUrl: await resolveThumbnailUrl(review.thumbnailUrl, { audience }),
    durationSeconds: review.durationSeconds,
    overallScore: review.overallScore,
    reviewNotes: review.reviewNotes,
    changeRequestNotes: review.changeRequestNotes,
    categoryScores: review.categoryScores.map((score) => ({
      categoryId: score.categoryId,
      categoryName: score.categoryName,
      categorySlug: score.categorySlug,
      score: score.score,
    })),
    publishedAt: review.publishedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export async function viewPublished(review: PublishedReviewRecord) {
  return {
    id: review.reviewId,
    publishedRevisionId: review.publishedRevisionId,
    version: review.version,
    productId: review.productId,
    product: review.productSnapshot,
    testerId: review.testerId,
    status: 'PUBLISHED',
    dispensaryName: review.dispensaryName,
    city: review.city,
    state: review.state,
    country: review.country,
    videoUrl: await playbackUrlForSubmission(review.videoObjectKey, review.videoUrl, {
      audience: 'public',
    }),
    thumbnailUrl: await resolveThumbnailUrl(review.thumbnailUrl, { audience: 'public' }),
    durationSeconds: review.durationSeconds,
    overallScore: review.overallScore,
    reviewNotes: review.reviewNotes,
    categoryScores: review.scoresSnapshot,
    publishedAt: review.publishedAt?.toISOString() ?? null,
  };
}

export class ProductReviewController {
  static async presign(request: FastifyRequest, reply: FastifyReply) {
    const body = presignReviewSchema.parse(request.body);
    const objectKey = buildReviewObjectKey({
      testerId: testerId(request),
      contentType: body.contentType,
    });
    const storage = getStorageService();
    const signed = await storage.createPresignedUpload({
      objectKey,
      contentType: body.contentType,
      contentLength: body.fileSizeBytes,
    });
    const thumbnailKey = thumbnailKeyForReview(objectKey);
    const thumbnail = thumbnailKey
      ? await storage.createPresignedUpload({
          objectKey: thumbnailKey,
          contentType: THUMBNAIL_CONTENT_TYPE,
        })
      : null;
    return sendSuccess(
      reply,
      { ...signed, thumbnail, durationSeconds: body.durationSeconds },
      'Presigned upload URL created',
      HTTP_STATUS.OK,
    );
  }

  static async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createReviewDraftSchema.parse(request.body);
    const actor = testerId(request);
    const parsed = parseReviewObjectKey(body.videoObjectKey);
    if (!parsed || parsed.testerId.toLowerCase() !== actor.toLowerCase()) {
      throw new ForbiddenError(
        'Forbidden: objectKey does not belong to the authenticated tester',
      );
    }
    const product = await ProductReviewRepository.findProduct(body.productId);
    if (!product) throw new NotFoundError('Product not found');
    if (body.productTypeId && product.productTypeId !== body.productTypeId) {
      throw new ValidationError('productTypeId does not match the product');
    }
    const storage = getStorageService();
    const review = await ProductReviewRepository.createDraft({
      productId: body.productId,
      testerId: actor,
      videoUrl: storage.getPublicUrl
        ? storage.getPublicUrl(body.videoObjectKey)
        : body.videoObjectKey,
      videoObjectKey: body.videoObjectKey,
      thumbnailUrl: body.thumbnailUrl ?? thumbnailKeyForReview(body.videoObjectKey),
      durationSeconds: body.durationSeconds,
      dispensaryName: body.dispensaryName,
      city: body.city,
      state: body.state,
      country: body.country,
      reviewNotes: body.reviewNotes,
    });
    if (body.categoryScores) {
      await ProductReviewRepository.replaceCategoryScores(
        review.id,
        await weightsFor(body.categoryScores),
      );
    }
    const stored = await ProductReviewRepository.findById(review.id);
    if (!stored) throw new NotFoundError('Review not found');
    return sendSuccess(
      reply,
      await viewReview(stored, 'restricted'),
      'Review draft created',
      HTTP_STATUS.CREATED,
    );
  }

  static async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const body = updateReviewDraftSchema.parse(request.body);
    const actor = testerId(request);
    const existing = await ProductReviewRepository.findById(id);
    if (!existing || existing.deletedAt) throw new NotFoundError('Review not found');
    if (existing.testerId !== actor) {
      throw new ForbiddenError('Forbidden: review is owned by another tester');
    }
    if (body.videoObjectKey) {
      const parsed = parseReviewObjectKey(body.videoObjectKey);
      if (!parsed || parsed.testerId.toLowerCase() !== actor.toLowerCase()) {
        throw new ForbiddenError(
          'Forbidden: objectKey does not belong to the authenticated tester',
        );
      }
    }
    if (body.productId || body.productTypeId) {
      const product = await ProductReviewRepository.findProduct(
        body.productId ?? existing.productId,
      );
      if (!product) throw new NotFoundError('Product not found');
      if (body.productTypeId && product.productTypeId !== body.productTypeId) {
        throw new ValidationError('productTypeId does not match the product');
      }
    }
    const editable =
      existing.status === 'DRAFT' || existing.status === 'CHANGES_REQUESTED';
    if (editable) {
      const updated = await ProductReviewRepository.updateDraft(id, actor, {
        productId: body.productId,
        videoObjectKey: body.videoObjectKey,
        videoUrl: body.videoObjectKey
          ? (getStorageService().getPublicUrl?.(body.videoObjectKey) ??
            body.videoObjectKey)
          : undefined,
        thumbnailUrl: body.thumbnailUrl,
        durationSeconds: body.durationSeconds,
        dispensaryName: body.dispensaryName,
        city: body.city,
        state: body.state,
        country: body.country,
        reviewNotes: body.reviewNotes,
        categoryScores: body.categoryScores
          ? await weightsFor(body.categoryScores)
          : undefined,
      });
      return sendSuccess(
        reply,
        await viewReview(updated, 'restricted'),
        'Review draft updated',
      );
    }
    const edited = await ProductReviewLifecycleService.handlePublishedEdit(id, actor, {
      productId: body.productId,
      videoObjectKey: body.videoObjectKey,
      videoUrl: body.videoObjectKey
        ? (getStorageService().getPublicUrl?.(body.videoObjectKey) ?? body.videoObjectKey)
        : undefined,
      thumbnailUrl: body.thumbnailUrl,
      durationSeconds: body.durationSeconds,
      reviewNotes: body.reviewNotes,
      dispensaryName: body.dispensaryName,
      city: body.city,
      state: body.state,
      country: body.country,
      categoryScores: body.categoryScores?.map((score) => ({
        categoryId: score.categoryId,
        score: score.score,
      })),
    });
    return sendSuccess(reply, await viewReview(edited, 'restricted'), 'Review updated');
  }

  static async submit(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const body = submitReviewSchema.parse(request.body ?? {});
    const actor = testerId(request);
    if (body.categoryScores) {
      const existing = await ProductReviewRepository.findById(id);
      if (!existing || existing.deletedAt) throw new NotFoundError('Review not found');
      if (existing.testerId !== actor) {
        throw new ForbiddenError('Forbidden: review is owned by another tester');
      }
      await ProductReviewRepository.replaceCategoryScores(
        id,
        await weightsFor(body.categoryScores),
      );
    }
    const review = await ProductReviewLifecycleService.submitDraft(id, actor);
    return sendSuccess(reply, await viewReview(review, 'restricted'), 'Review submitted');
  }

  static async mine(request: FastifyRequest, reply: FastifyReply) {
    const query = reviewListQuerySchema
      .pick({ page: true, limit: true })
      .parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;
    const page = await ProductReviewRepository.listMinePage(
      testerId(request),
      skip,
      query.limit,
    );
    const items = await Promise.all(
      page.rows.map((review) => viewReview(review, 'restricted')),
    );
    return sendPaginated(
      reply,
      items,
      page.total,
      query.page,
      query.limit,
      'Reviews retrieved',
    );
  }
}

export async function publicReviewPage(
  query: ReturnType<typeof reviewListQuerySchema.parse>,
) {
  const page = await ProductReviewRepository.listPublicPage({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    sort: query.sort,
    productId: query.productId,
    productTypeId: query.productTypeId,
    categoryId: query.categoryId,
    testerId: query.testerId,
    city: query.city,
    state: query.state,
    country: query.country,
    dispensaryName: query.dispensaryName,
    minOverallScore: query.minOverallScore,
    maxOverallScore: query.maxOverallScore,
    publishedFrom: query.publishedFrom,
    publishedTo: query.publishedTo,
  });
  return {
    total: page.total,
    items: await Promise.all(page.rows.map((row) => viewPublished(row))),
    page: query.page,
    limit: query.limit,
  };
}

export function leaderboardResult(
  items: Awaited<ReturnType<typeof publicReviewPage>>['items'],
  total: number,
  page: number,
  limit: number,
) {
  return {
    ranking: 'published-review' as const,
    ...buildPaginatedResult(items, total, page, limit),
  };
}
