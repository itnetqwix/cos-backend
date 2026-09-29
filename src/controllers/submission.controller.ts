import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { SubmissionRecord } from '../repositories/submission.repository.js';
import {
  completeSubmissionSchema,
  presignSubmissionSchema,
  submissionIdParamSchema,
} from '../schemas/submission.schema.js';
import { SubmissionService } from '../services/submission.service.js';
import { playbackUrlForSubmission } from '../services/storage.service.js';
import { sendSuccess } from '../utils/response.js';

function actorFromRequest(request: FastifyRequest) {
  return {
    id: request.user.id,
    role: request.user.role,
  };
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function toSubmissionView(submission: SubmissionRecord) {
  return {
    id: submission.id,
    contestId: submission.contestId,
    creatorId: submission.creatorId,
    title: submission.title,
    description: submission.description,
    videoUrl: await playbackUrlForSubmission(submission.objectKey, submission.videoUrl),
    objectKey: submission.objectKey,
    thumbnailUrl: submission.thumbnailUrl,
    durationSeconds: submission.durationSeconds,
    status: submission.status,
    rejectionReason: submission.rejectionReason,
    moderatedById: submission.moderatedById,
    moderatedAt: iso(submission.moderatedAt),
    tags: submission.tags,
    communityScore: submission.communityScore,
    totalVotes: submission.totalVotes,
    createdAt: iso(submission.createdAt),
    updatedAt: iso(submission.updatedAt),
    contest: submission.contest,
  };
}

export class SubmissionController {
  /**
   * POST /api/v1/submissions/presign
   */
  static async presign(request: FastifyRequest, reply: FastifyReply) {
    const body = presignSubmissionSchema.parse(request.body);
    const signed = await SubmissionService.presign(actorFromRequest(request), body);
    return sendSuccess(reply, signed, 'Presigned upload URL created', HTTP_STATUS.OK);
  }

  /**
   * POST /api/v1/submissions/complete
   */
  static async complete(request: FastifyRequest, reply: FastifyReply) {
    const body = completeSubmissionSchema.parse(request.body);
    const { submission, created } = await SubmissionService.complete(
      actorFromRequest(request),
      body,
    );
    if (!created) {
      return sendSuccess(
        reply,
        await toSubmissionView(submission),
        'Submission already registered',
        HTTP_STATUS.OK,
      );
    }
    return sendSuccess(
      reply,
      await toSubmissionView(submission),
      'Submission created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * GET /api/v1/submissions/me
   */
  static async listMine(request: FastifyRequest, reply: FastifyReply) {
    const submissions = await SubmissionService.listMine(actorFromRequest(request));
    return sendSuccess(
      reply,
      await Promise.all(submissions.map((submission) => toSubmissionView(submission))),
      'Submissions retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/submissions/:id
   */
  static async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = submissionIdParamSchema.parse(request.params);
    const submission = await SubmissionService.getById(actorFromRequest(request), id);
    return sendSuccess(
      reply,
      await toSubmissionView(submission),
      'Submission retrieved successfully',
      HTTP_STATUS.OK,
    );
  }
}
