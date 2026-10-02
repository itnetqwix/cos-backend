import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  adminSubmissionIdParamSchema,
  creatorIdParamSchema,
} from '../schemas/admin-creator.schema.js';
import { AdminCreatorService } from '../services/admin-creator.service.js';
import { sendSuccess } from '../utils/response.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class AdminCreatorController {
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const result = await AdminCreatorService.list(actorFromRequest(request));
    return sendSuccess(
      reply,
      {
        totalCreators: result.totalCreators,
        creators: result.creators.map((creator) => ({
          ...creator,
          createdAt: iso(creator.createdAt),
        })),
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
        },
        submissions: result.submissions.map((submission) => ({
          ...submission,
          createdAt: iso(submission.createdAt),
        })),
      },
      'Creator retrieved successfully',
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
