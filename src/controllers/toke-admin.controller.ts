import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { ReviewStatus } from '@prisma/client';
import { ProductReviewRepository } from '../repositories/product-review.repository.js';
import { TokeAuditRepository } from '../repositories/toke-audit.repository.js';
import { ProductReviewLifecycleService } from '../services/product-review-lifecycle.service.js';
import {
  adminReviewListQuerySchema,
  disqualifyReviewSchema,
  rejectReviewSchema,
  testerIdParamSchema,
  tokeAdminAuditQuerySchema,
} from '../schemas/toke-admin.schema.js';
import { reviewIdParamSchema } from '../schemas/product-review.schema.js';
import {
  playbackUrlForSubmission,
  resolveThumbnailUrl,
} from '../services/storage.service.js';
import { NotFoundError, sendPaginated, sendSuccess } from '../utils/response.js';

export class TokeAdminController {
  /**
   * GET /api/v1/admin/toke/metrics
   * Central dashboard KPI counts across testers, applications, catalog, categories, and reviews.
   */
  static async metrics(_request: FastifyRequest, reply: FastifyReply) {
    const [
      verifiedTestersCount,
      pendingApplicationsCount,
      activeProductsCount,
      pendingProductsCount,
      activeCategoriesCount,
      pendingCategoryProposalsCount,
      reviewsAwaitingApprovalCount,
      publishedReviewsCount,
      rejectedReviewsCount,
      totalReviewsCount,
      recentAudit,
    ] = await Promise.all([
      prisma.user.count({ where: { testerStatus: 'VERIFIED' } }),
      prisma.testerApplication.count({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'NEEDS_INFORMATION'] } },
      }),
      prisma.product.count({ where: { isActive: true, approvalStatus: 'APPROVED' } }),
      prisma.product.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.reviewCategory.count({ where: { isActive: true } }),
      prisma.reviewCategoryProposal.count({ where: { status: 'PENDING' } }),
      prisma.productReview.count({
        where: { status: ReviewStatus.SUBMITTED, deletedAt: null },
      }),
      prisma.productReview.count({
        where: { status: ReviewStatus.PUBLISHED, deletedAt: null },
      }),
      prisma.productReview.count({
        where: {
          status: { in: [ReviewStatus.REJECTED, ReviewStatus.DISQUALIFIED] },
          deletedAt: null,
        },
      }),
      prisma.productReview.count({ where: { deletedAt: null } }),
      TokeAuditRepository.listPage({ skip: 0, take: 8 }),
    ]);

    return sendSuccess(
      reply,
      {
        verifiedTestersCount,
        pendingApplicationsCount,
        activeProductsCount,
        pendingProductsCount,
        activeCategoriesCount,
        pendingCategoryProposalsCount,
        reviewsAwaitingApprovalCount,
        publishedReviewsCount,
        rejectedReviewsCount,
        totalReviewsCount,
        recentAuditLogs: recentAudit.rows,
        counts: {
          verifiedTesters: verifiedTestersCount,
          pendingApplications: pendingApplicationsCount,
          activeProducts: activeProductsCount,
          pendingProducts: pendingProductsCount,
          activeCategories: activeCategoriesCount,
          pendingCategoryProposals: pendingCategoryProposalsCount,
          reviewsAwaitingApproval: reviewsAwaitingApprovalCount,
          publishedReviews: publishedReviewsCount,
          rejectedOrDisqualifiedReviews: rejectedReviewsCount,
          totalReviews: totalReviewsCount,
        },
        recentAudit: recentAudit.rows,
      },
      'Dashboard metrics retrieved successfully',
    );
  }

  /**
   * GET /api/v1/admin/toke/audit
   * Searchable and paginated administrative audit logs.
   */
  static async audit(request: FastifyRequest, reply: FastifyReply) {
    const query = tokeAdminAuditQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const page = await TokeAuditRepository.listPage({
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      search: query.search,
      fromDate: query.fromDate,
      toDate: query.toDate,
      skip,
      take: query.limit,
    });

    return sendPaginated(
      reply,
      page.rows,
      page.total,
      query.page,
      query.limit,
      'Audit logs retrieved successfully',
    );
  }

  /**
   * GET /api/v1/admin/toke/reviews
   * Unified all-reviews listing with rich filtering for admins.
   */
  static async reviews(request: FastifyRequest, reply: FastifyReply) {
    const query = adminReviewListQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const page = await ProductReviewRepository.listAdminReviewsPage({
      skip,
      take: query.limit,
      status: query.status,
      productId: query.productId,
      productTypeId: query.productTypeId,
      testerId: query.testerId,
      search: query.search,
      city: query.city,
      state: query.state,
      country: query.country,
      dispensaryName: query.dispensaryName,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });

    const items = await Promise.all(
      page.rows.map(async (review) => ({
        id: review.id,
        status: review.status,
        overallScore: review.overallScore,
        productId: review.productId,
        product: review.product,
        testerId: review.testerId,
        tester: review.tester,
        createdByAdminId: review.createdByAdminId,
        dispensaryName: review.dispensaryName,
        dispensaryAddress: review.dispensaryAddress,
        city: review.city,
        state: review.state,
        country: review.country,
        durationSeconds: review.durationSeconds,
        thumbnailUrl: await resolveThumbnailUrl(review.thumbnailUrl, {
          audience: 'restricted',
        }),
        videoUrl: await playbackUrlForSubmission(review.videoObjectKey, review.videoUrl, {
          audience: 'restricted',
        }),
        changeRequestNotes: review.changeRequestNotes,
        rejectionReason: review.rejectionReason,
        createdAt: review.createdAt.toISOString(),
        updatedAt: review.updatedAt.toISOString(),
        publishedAt: review.publishedAt?.toISOString() ?? null,
      })),
    );

    return sendPaginated(
      reply,
      items,
      page.total,
      query.page,
      query.limit,
      'Admin reviews retrieved successfully',
    );
  }

  /**
   * GET /api/v1/admin/toke/reviews/:id
   * Complete review detail with scorecard, video playback, and revision history.
   */
  static async reviewDetail(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const review = await ProductReviewRepository.findById(id);
    if (!review || review.deletedAt) throw new NotFoundError('Review not found');

    const [revisions, tester] = await Promise.all([
      ProductReviewRepository.listRevisions(id),
      prisma.user.findUnique({
        where: { id: review.testerId },
        select: {
          id: true,
          name: true,
          email: true,
          testerStatus: true,
          testerBio: true,
        },
      }),
    ]);

    return sendSuccess(
      reply,
      {
        id: review.id,
        productId: review.productId,
        product: review.product,
        testerId: review.testerId,
        tester: tester ?? { id: review.testerId, name: 'Unknown', email: '' },
        createdByAdminId: review.createdByAdminId,
        status: review.status,
        overallScore: review.overallScore,
        dispensaryName: review.dispensaryName,
        dispensaryAddress: review.dispensaryAddress,
        city: review.city,
        state: review.state,
        country: review.country,
        videoUrl: await playbackUrlForSubmission(review.videoObjectKey, review.videoUrl, {
          audience: 'restricted',
        }),
        videoObjectKey: review.videoObjectKey,
        thumbnailUrl: await resolveThumbnailUrl(review.thumbnailUrl, {
          audience: 'restricted',
        }),
        durationSeconds: review.durationSeconds,
        reviewNotes: review.reviewNotes,
        changeRequestNotes: review.changeRequestNotes,
        rejectionReason: review.rejectionReason,
        categoryScores: review.categoryScores.map((score) => ({
          categoryId: score.categoryId,
          categoryName: score.categoryName,
          categorySlug: score.categorySlug,
          score: score.score,
          weightApplied: score.weightApplied,
        })),
        revisions: revisions.map((rev) => ({
          id: rev.id,
          version: rev.version,
          overallScore: rev.overallScore,
          dispensaryName: rev.dispensaryName,
          dispensaryAddress: rev.dispensaryAddress,
          reviewNotes: rev.reviewNotes,
          changeRequestNotes: rev.changeRequestNotes,
          changedById: rev.changedById,
          changeReason: rev.changeReason,
          createdAt: rev.createdAt.toISOString(),
        })),
        approvedById: review.approvedById,
        approvedAt: review.approvedAt?.toISOString() ?? null,
        publishedAt: review.publishedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        updatedAt: review.updatedAt.toISOString(),
      },
      'Review details retrieved',
    );
  }

  /**
   * POST /api/v1/admin/toke/reviews/:id/reject
   * Permanently reject a review with mandatory reason text.
   */
  static async rejectReview(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const body = rejectReviewSchema.parse(request.body);
    const adminId = request.user.id;

    const review = await ProductReviewLifecycleService.rejectReview(
      id,
      adminId,
      body.reason,
    );

    await TokeAuditRepository.record({
      actorId: adminId,
      entityType: 'REVIEW',
      entityId: id,
      action: 'REJECT',
      reason: body.reason,
      details: {
        status: review.status,
        productId: review.productId,
        testerId: review.testerId,
      },
    });

    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        rejectionReason: review.rejectionReason,
      },
      'Review rejected successfully',
    );
  }

  /**
   * POST /api/v1/admin/toke/reviews/:id/disqualify
   * Delist / disqualify a published or approved review with mandatory reason text.
   */
  static async disqualifyReview(request: FastifyRequest, reply: FastifyReply) {
    const { id } = reviewIdParamSchema.parse(request.params);
    const body = disqualifyReviewSchema.parse(request.body);
    const adminId = request.user.id;

    const review = await ProductReviewLifecycleService.disqualifyReview(
      id,
      adminId,
      body.reason,
    );

    await TokeAuditRepository.record({
      actorId: adminId,
      entityType: 'REVIEW',
      entityId: id,
      action: 'DISQUALIFY',
      reason: body.reason,
      details: {
        status: review.status,
        productId: review.productId,
        testerId: review.testerId,
      },
    });

    return sendSuccess(
      reply,
      {
        id: review.id,
        status: review.status,
        rejectionReason: review.rejectionReason,
      },
      'Review disqualified and delisted successfully',
    );
  }

  /**
   * GET /api/v1/admin/toke/testers/:id
   * Detailed tester profile, verification history, review stats, and review list.
   * Does NOT expose private application documents or sensitive applicant phone/address.
   */
  static async testerDetail(request: FastifyRequest, reply: FastifyReply) {
    const { id } = testerIdParamSchema.parse(request.params);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        testerStatus: true,
        testerBio: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            reviewsAuthored: true,
          },
        },
        reviewsAuthored: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            status: true,
            overallScore: true,
            dispensaryName: true,
            city: true,
            state: true,
            createdAt: true,
            product: {
              select: {
                id: true,
                name: true,
                brandName: true,
              },
            },
          },
        },
        testerApplications: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            fullName: true,
            experienceYears: true,
            preferredProductTypes: true,
            createdAt: true,
            reviewedAt: true,
            rejectionReason: true,
            applicantNotes: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError('Tester not found');

    const publishedReviews = user.reviewsAuthored.filter((r) => r.status === 'PUBLISHED');
    const publishedCount = publishedReviews.length;
    const avgScore =
      publishedCount > 0
        ? Math.round(
            (publishedReviews.reduce((acc, r) => acc + r.overallScore, 0) /
              publishedCount) *
              10,
          ) / 10
        : null;

    const auditLogs = await prisma.testerAuditLog.findMany({
      where: { targetUserId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    return sendSuccess(
      reply,
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        testerStatus: user.testerStatus,
        testerBio: user.testerBio,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        totalReviews: user._count.reviewsAuthored,
        publishedReviews: publishedCount,
        averageOverallScore: avgScore,
        recentReviews: user.reviewsAuthored.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
        applications: user.testerApplications.map((app) => ({
          ...app,
          createdAt: app.createdAt.toISOString(),
          reviewedAt: app.reviewedAt?.toISOString() ?? null,
        })),
        auditHistory: auditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          reason: log.reason,
          actor: log.actor,
          createdAt: log.createdAt.toISOString(),
        })),
      },
      'Tester details retrieved successfully',
    );
  }
}
