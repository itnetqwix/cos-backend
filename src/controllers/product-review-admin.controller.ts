import { FastifyReply, FastifyRequest } from 'fastify';
import { ProductReviewRepository } from '../repositories/product-review.repository.js';
import {
  approveReviewSchema,
  publishReviewSchema,
  requestReviewChangesSchema,
  reviewIdParamSchema,
  reviewListQuerySchema,
  reviewQueueQuerySchema,
} from '../schemas/product-review.schema.js';
import { ProductReviewLifecycleService } from '../services/product-review-lifecycle.service.js';
import {
  playbackUrlForSubmission,
  resolveThumbnailUrl,
} from '../services/storage.service.js';
import { NotFoundError } from '../utils/response.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';
import {
  leaderboardResult,
  publicReviewPage,
  viewPublished,
} from './product-review.controller.js';

function approverId(request: FastifyRequest): string {
  return request.user.id;
}

export class ProductReviewAdminController {
  static async queue(request: FastifyRequest, reply: FastifyReply) {
    const query = reviewQueueQuerySchema.parse(request.query ?? {});
    const page = await ProductReviewRepository.listQueuePage({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      productId: query.productId,
      testerId: query.testerId,
    });
    const items = await Promise.all(
      page.rows.map(async (review) => ({
        id: review.id,
        status: review.status,
        product: review.product,
        tester: review.tester,
        dispensaryName: review.dispensaryName,
        city: review.city,
        state: review.state,
        country: review.country,
        videoObjectKey: review.videoObjectKey,
        videoUrl: await playbackUrlForSubmission(review.videoObjectKey, review.videoUrl, {
          audience: 'restricted',
        }),
        thumbnailUrl: await resolveThumbnailUrl(review.thumbnailUrl, {
          audience: 'restricted',
        }),
        durationSeconds: review.durationSeconds,
        overallScore: review.overallScore,
        reviewNotes: review.reviewNotes,
        categoryScores: review.categoryScores.map((score) => ({
          categoryId: score.categoryId,
          categoryName: score.categoryName,
          score: score.score,
          weightApplied: score.weightApplied,
        })),
        createdAt: review.createdAt.toISOString(),
      })),
    );
    return sendPaginated(
      reply,
      items,
      page.total,
      query.page,
      query.limit,
      'Review queue retrieved',
    );
  }

  static async requestChanges(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const body = requestReviewChangesSchema.parse(request.body);
    const review = await ProductReviewLifecycleService.requestChanges(
      id,
      approverId(request),
      body.notes,
    );
    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        changeRequestNotes: review.changeRequestNotes,
      },
      'Changes requested',
    );
  }

  static async approve(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    approveReviewSchema.parse(request.body ?? {});
    const review = await ProductReviewLifecycleService.approveReview(
      id,
      approverId(request),
    );
    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        approvedById: review.approvedById,
        approvedAt: review.approvedAt?.toISOString() ?? null,
        publishedAt: review.publishedAt?.toISOString() ?? null,
      },
      'Review approved',
    );
  }

  static async publish(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    publishReviewSchema.parse(request.body ?? {});
    const review = await ProductReviewLifecycleService.publishReview(
      id,
      approverId(request),
    );
    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        publishedAt: review.publishedAt?.toISOString() ?? null,
        publishedRevisionId: review.publishedRevisionId,
      },
      'Review published',
    );
  }

  static async approveAndPublish(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const review = await ProductReviewLifecycleService.approveAndPublishReview(
      id,
      approverId(request),
    );
    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        approvedById: review.approvedById,
        publishedAt: review.publishedAt?.toISOString() ?? null,
        publishedRevisionId: review.publishedRevisionId,
      },
      'Review approved and published',
    );
  }

  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = reviewListQuerySchema.parse(request.query ?? {});
    const page = await publicReviewPage(query);
    return sendPaginated(
      reply,
      page.items,
      page.total,
      page.page,
      page.limit,
      'Published reviews retrieved',
    );
  }

  static async detail(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const review = await ProductReviewRepository.findPublished(id);
    if (!review) throw new NotFoundError('Review not found');
    return sendSuccess(reply, await viewPublished(review), 'Published review retrieved');
  }

  static async leaderboard(request: FastifyRequest, reply: FastifyReply) {
    const query = reviewListQuerySchema.parse({
      ...(request.query as object),
      sort: 'score',
    });
    const page = await publicReviewPage(query);
    return sendSuccess(
      reply,
      leaderboardResult(page.items, page.total, page.page, page.limit),
      'Published reviews ranked by overall score',
    );
  }
}
