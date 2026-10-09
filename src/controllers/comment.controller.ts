import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  commentSubmissionParamSchema,
  createCommentBodySchema,
} from '../schemas/comment.schema.js';
import { CommentRecord, CommentService } from '../services/comment.service.js';
import { signedAvatarUrl } from '../services/storage.service.js';
import { sendSuccess } from '../utils/response.js';

async function toCommentView(comment: CommentRecord) {
  const avatarUrl = await signedAvatarUrl(comment.author.avatarObjectKey);
  return {
    id: comment.id,
    submissionId: comment.submissionId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: {
      id: comment.author.id,
      name: comment.author.name,
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
}

export class CommentController {
  /**
   * GET /api/v1/submissions/:id/comments
   * Public read. Comments are scoped to this submission.
   */
  static async list(request: FastifyRequest, reply: FastifyReply) {
    const { id } = commentSubmissionParamSchema.parse(request.params);
    const comments = await CommentService.listForSubmission(id);
    return sendSuccess(
      reply,
      await Promise.all(comments.map(toCommentView)),
      'Comments retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/submissions/:id/comments
   * Authenticated only. Guest authorship is NOT SPECIFIED.
   */
  static async create(request: FastifyRequest, reply: FastifyReply) {
    const { id } = commentSubmissionParamSchema.parse(request.params);
    const body = createCommentBodySchema.parse(request.body ?? {});
    const comment = await CommentService.create({
      submissionId: id,
      authorId: request.user?.id ?? null,
      body: body.body,
    });
    return sendSuccess(
      reply,
      await toCommentView(comment),
      'Comment created',
      HTTP_STATUS.CREATED,
    );
  }
}
