import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  adminContestIdParamSchema,
  adminSubmissionIdParamSchema,
  creatorIdParamSchema,
  creatorPageQuerySchema,
  creatorStatusSchema,
  listCreatorsQuerySchema,
  warnCreatorSchema,
} from '../schemas/admin-creator.schema.js';
import { AdminCreatorService } from '../services/admin-creator.service.js';
import { sendSuccess } from '../utils/response.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class AdminCreatorController {
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listCreatorsQuerySchema.parse(request.query ?? {});
    const result = await AdminCreatorService.list(actorFromRequest(request), query);
    return sendSuccess(
      reply,
      {
        totalCreators: result.totalCreators,
        summary: result.summary,
        creators: result.creators.map((creator) => ({
          ...creator,
          createdAt: iso(creator.createdAt),
          lastActivityAt: iso(creator.lastActivityAt),
        })),
        pagination: result.pagination,
      },
      'Creators retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const result = await AdminCreatorService.getProfile(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      {
        creator: {
          ...result.creator,
          createdAt: iso(result.creator.createdAt),
          lastActivityAt: iso(result.creator.lastActivityAt),
        },
        stats: result.stats,
        warnings: result.warnings.map((warning) => ({
          ...warning,
          createdAt: iso(warning.createdAt),
        })),
        submissions: result.submissions.map((submission) => ({
          ...submission,
          createdAt: iso(submission.createdAt),
          updatedAt: iso(submission.updatedAt),
        })),
      },
      'Creator retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async contests(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const result = await AdminCreatorService.listContests(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      {
        creatorId: result.creatorId,
        contests: result.contests.map((contest) => ({
          ...contest,
          firstSubmissionAt: iso(contest.firstSubmissionAt),
          latestSubmissionAt: iso(contest.latestSubmissionAt),
          submissions: contest.submissions.map((submission) => ({
            ...submission,
            createdAt: iso(submission.createdAt),
            updatedAt: iso(submission.updatedAt),
          })),
        })),
      },
      'Creator contests retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async submissions(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const query = creatorPageQuerySchema.parse(request.query ?? {});
    const result = await AdminCreatorService.listSubmissions(
      actorFromRequest(request),
      id,
      query,
    );
    return sendSuccess(
      reply,
      {
        items: result.items.map((item) => ({
          ...item,
          createdAt: iso(item.createdAt),
          updatedAt: iso(item.updatedAt),
        })),
        pagination: result.pagination,
      },
      'Creator submissions retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async activity(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const query = creatorPageQuerySchema.parse(request.query ?? {});
    const result = await AdminCreatorService.listActivity(
      actorFromRequest(request),
      id,
      query,
    );
    return sendSuccess(
      reply,
      {
        items: result.items.map((item) => ({
          ...item,
          createdAt: iso(item.createdAt),
        })),
        pagination: result.pagination,
      },
      'Creator activity retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async warn(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const body = warnCreatorSchema.parse(request.body);
    const result = await AdminCreatorService.warn(
      actorFromRequest(request),
      id,
      body.reason,
    );
    return sendSuccess(
      reply,
      {
        ...result,
        createdAt: iso(result.createdAt),
      },
      'Warning issued successfully',
      HTTP_STATUS.CREATED,
    );
  }

  static async setStatus(request: FastifyRequest, reply: FastifyReply) {
    const { id } = creatorIdParamSchema.parse(request.params);
    const body = creatorStatusSchema.parse(request.body);
    const result = await AdminCreatorService.setStatus(
      actorFromRequest(request),
      id,
      body.accountStatus,
    );
    return sendSuccess(
      reply,
      result,
      'Creator status updated successfully',
      HTTP_STATUS.OK,
    );
  }

  static async contestParticipants(request: FastifyRequest, reply: FastifyReply) {
    const { id } = adminContestIdParamSchema.parse(request.params);
    const query = creatorPageQuerySchema.parse(request.query ?? {});
    const result = await AdminCreatorService.contestParticipants(
      actorFromRequest(request),
      id,
      query,
    );
    return sendSuccess(
      reply,
      {
        contest: result.contest,
        participatingCreatorCount: result.participatingCreatorCount,
        creators: result.creators.map((creator) => ({
          ...creator,
          firstSubmissionAt: iso(creator.firstSubmissionAt),
          latestSubmissionAt: iso(creator.latestSubmissionAt),
          submissions: creator.submissions.map((submission) => ({
            ...submission,
            createdAt: iso(submission.createdAt),
            updatedAt: iso(submission.updatedAt),
          })),
        })),
        pagination: result.pagination,
      },
      'Contest participants retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  static async deleteSubmission(request: FastifyRequest, reply: FastifyReply) {
    const { id } = adminSubmissionIdParamSchema.parse(request.params);
    const result = await AdminCreatorService.deleteSubmission(
      actorFromRequest(request),
      id,
    );
    return sendSuccess(reply, result, 'Submission deleted successfully', HTTP_STATUS.OK);
  }
}
