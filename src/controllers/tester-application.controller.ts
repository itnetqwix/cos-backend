import { FastifyReply, FastifyRequest } from 'fastify';
import { ReviewStatus } from '@prisma/client';
import { HTTP_STATUS } from '../config/constants.js';
import { prisma } from '../config/database.js';
import { TesterApplicationRepository } from '../repositories/tester-application.repository.js';
import {
  applicationIdParamSchema,
  applicationListQuerySchema,
  publicTesterQuerySchema,
  rejectApplicationSchema,
  reinstateTesterSchema,
  requestInfoSchema,
  respondInfoSchema,
  submitTesterApplicationSchema,
  suspendTesterSchema,
  testerIdParamSchema,
  testerListQuerySchema,
  updateTesterApplicationSchema,
  revokeTesterSchema,
} from '../schemas/tester-application.schema.js';
import { TesterApplicationService } from '../services/tester-application.service.js';
import {
  playbackUrlForSubmission,
  resolveThumbnailUrl,
  signedAvatarUrl,
} from '../services/storage.service.js';
import { NotFoundError, sendPaginated, sendSuccess } from '../utils/response.js';

export class TesterApplicationController {
  // -------------------------------------------------------------
  // Applicant Endpoints
  // -------------------------------------------------------------

  static async submit(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const body = submitTesterApplicationSchema.parse(request.body);
    const application = await TesterApplicationService.submitApplication(userId, body);

    return sendSuccess(
      reply,
      application,
      'Tester application submitted successfully',
      HTTP_STATUS.CREATED,
    );
  }

  static async mine(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const result = await TesterApplicationService.getMyApplication(userId);

    return sendSuccess(reply, result, 'Tester application retrieved');
  }

  static async update(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const body = updateTesterApplicationSchema.parse(request.body);
    const application = await TesterApplicationService.updateMyApplication(userId, body);

    return sendSuccess(reply, application, 'Tester application updated');
  }

  static async respond(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.id;
    const body = respondInfoSchema.parse(request.body);
    const application = await TesterApplicationService.respondToInformationRequest(
      userId,
      body.notes,
      {
        credentials: body.credentials,
        sampleReviewUrl: body.sampleReviewUrl,
        portfolioUrls: body.portfolioUrls,
        bio: body.bio,
      },
    );

    return sendSuccess(reply, application, 'Information response submitted successfully');
  }

  // -------------------------------------------------------------
  // Administrative Application Endpoints
  // -------------------------------------------------------------

  static async listApplications(request: FastifyRequest, reply: FastifyReply) {
    const query = applicationListQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const page = await TesterApplicationRepository.listApplicationsPage({
      status: query.status,
      search: query.search,
      skip,
      take: query.limit,
    });

    return sendPaginated(
      reply,
      page.rows,
      page.total,
      query.page,
      query.limit,
      'Tester applications retrieved',
    );
  }

  static async getApplication(request: FastifyRequest, reply: FastifyReply) {
    const { id } = applicationIdParamSchema.parse(request.params);
    const application = await TesterApplicationService.getApplicationDetails(id);

    return sendSuccess(reply, application, 'Tester application details retrieved');
  }

  static async markUnderReview(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = applicationIdParamSchema.parse(request.params);
    const application = await TesterApplicationService.markUnderReview(adminId, id);

    return sendSuccess(reply, application, 'Application marked under review');
  }

  static async requestInfo(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = applicationIdParamSchema.parse(request.params);
    const body = requestInfoSchema.parse(request.body);
    const application = await TesterApplicationService.requestInformation(
      adminId,
      id,
      body.notes,
    );

    return sendSuccess(reply, application, 'Additional information requested');
  }

  static async approve(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = applicationIdParamSchema.parse(request.params);
    const application = await TesterApplicationService.approveApplication(adminId, id);

    return sendSuccess(
      reply,
      application,
      'Tester application approved and verified tester access activated',
    );
  }

  static async reject(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = applicationIdParamSchema.parse(request.params);
    const body = rejectApplicationSchema.parse(request.body);
    const application = await TesterApplicationService.rejectApplication(
      adminId,
      id,
      body.reason,
    );

    return sendSuccess(reply, application, 'Tester application rejected');
  }

  // -------------------------------------------------------------
  // Administrative Tester Management Endpoints
  // -------------------------------------------------------------

  static async listTesters(request: FastifyRequest, reply: FastifyReply) {
    const query = testerListQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const page = await TesterApplicationRepository.listTestersPage({
      status: query.status,
      search: query.search,
      skip,
      take: query.limit,
    });

    return sendPaginated(
      reply,
      page.rows,
      page.total,
      query.page,
      query.limit,
      'Testers list retrieved',
    );
  }

  static async suspendTester(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = testerIdParamSchema.parse(request.params);
    const body = suspendTesterSchema.parse(request.body);
    const user = await TesterApplicationService.suspendTester(adminId, id, body.reason);

    return sendSuccess(reply, user, 'Tester access suspended');
  }

  static async revokeTester(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = testerIdParamSchema.parse(request.params);
    const body = revokeTesterSchema.parse(request.body);
    const user = await TesterApplicationService.revokeTester(adminId, id, body.reason);

    return sendSuccess(reply, user, 'Tester access permanently revoked');
  }

  static async reinstateTester(request: FastifyRequest, reply: FastifyReply) {
    const adminId = request.user.id;
    const { id } = testerIdParamSchema.parse(request.params);
    const body = reinstateTesterSchema.parse(request.body ?? {});
    const user = await TesterApplicationService.reinstateTester(adminId, id, body.notes);

    return sendSuccess(reply, user, 'Tester access reinstated');
  }

  /**
   * GET /api/v1/toke/testers/:id
   * Public profile for verified testers only.
   * Returns public professional profile, authoring statistics, and paginated published reviews.
   * Unverified, suspended, or revoked testers return 404.
   * Private contact and applicant data is never returned.
   */
  static async publicTesterProfile(request: FastifyRequest, reply: FastifyReply) {
    const { id } = testerIdParamSchema.parse(request.params);
    const query = publicTesterQuerySchema.parse(request.query ?? {});

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        testerStatus: true,
        testerBio: true,
        avatarObjectKey: true,
      },
    });

    if (!user || user.testerStatus !== 'VERIFIED') {
      throw new NotFoundError('Verified tester profile not found');
    }

    const application = await prisma.testerApplication.findFirst({
      where: { userId: id, status: 'APPROVED' },
      orderBy: { reviewedAt: 'desc' },
      select: { experienceYears: true, preferredProductTypes: true },
    });

    const page = query.page;
    const limit = query.limit;
    const where = {
      testerId: id,
      status: ReviewStatus.PUBLISHED,
      deletedAt: null,
      publishedRevisionId: { not: null },
    };

    const [total, reviews, scoreAgg] = await Promise.all([
      prisma.productReview.count({ where }),
      prisma.productReview.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        include: {
          product: { include: { productType: true } },
          categoryScores: { include: { category: true } },
        },
      }),
      prisma.productReview.aggregate({
        where,
        _avg: { overallScore: true },
      }),
    ]);

    const revIds = reviews.flatMap((r) =>
      r.publishedRevisionId ? [r.publishedRevisionId] : [],
    );
    const revisions = revIds.length
      ? await prisma.reviewRevision.findMany({ where: { id: { in: revIds } } })
      : [];
    const revMap = new Map(revisions.map((rev) => [rev.id, rev]));

    const mappedReviews = await Promise.all(
      reviews.map(async (r) => {
        const rev = r.publishedRevisionId ? revMap.get(r.publishedRevisionId) : null;
        const videoObjectKey = rev?.videoObjectKey ?? r.videoObjectKey;
        const videoUrl = rev?.videoUrl ?? r.videoUrl;
        const thumbnailUrl = rev?.thumbnailUrl ?? r.thumbnailUrl;
        return {
          id: r.id,
          overallScore: rev?.overallScore ?? r.overallScore,
          durationSeconds: rev?.durationSeconds ?? r.durationSeconds,
          videoUrl: await playbackUrlForSubmission(videoObjectKey, videoUrl, {
            audience: 'public',
          }),
          thumbnailUrl: await resolveThumbnailUrl(thumbnailUrl, { audience: 'public' }),
          dispensaryName: rev?.dispensaryName ?? r.dispensaryName,
          city: rev?.city ?? r.city,
          state: rev?.state ?? r.state,
          publishedAt: r.publishedAt?.toISOString() ?? null,
          product: rev
            ? (rev.productSnapshot as unknown as Record<string, unknown>)
            : {
                productId: r.product.id,
                name: r.product.name,
                brandName: r.product.brandName,
                productTypeId: r.product.productTypeId,
                productTypeName: r.product.productType.name,
                productTypeSlug: r.product.productType.slug,
              },
          categoryScores: rev ? (rev.scoresSnapshot as unknown as unknown[]) : [],
        };
      }),
    );

    const averagePublishedScore = scoreAgg._avg.overallScore
      ? Math.round(scoreAgg._avg.overallScore * 10) / 10
      : null;

    const avatarUrl = user.avatarObjectKey
      ? await signedAvatarUrl(user.avatarObjectKey)
      : null;

    return sendSuccess(
      reply,
      {
        id: user.id,
        name: user.name,
        testerBio: user.testerBio,
        avatarUrl,
        isVerified: true,
        experienceYears: application?.experienceYears ?? null,
        preferredProductTypes: application?.preferredProductTypes ?? [],
        totalPublishedReviews: total,
        averagePublishedScore,
        reviews: {
          items: mappedReviews,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
      'Verified tester profile retrieved successfully',
    );
  }
}
