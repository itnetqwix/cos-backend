import { CommentRecord, CommentRepository } from '../repositories/comment.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../utils/response.js';

export type { CommentRecord };

/**
 * Comments attach to a submission.
 *
 * Guest comment authorship is NOT SPECIFIED in the product source.
 * This service does not invent an anonymous identity (no IP-hash author).
 * Creating a comment requires an authenticated authorId.
 * Reading comments is public, matching the public judging queue.
 *
 * Maximum body length is an engineering cap. A product maximum is NOT SPECIFIED.
 */

export const COMMENT_BODY_MAX = 500;

export function normalizeCommentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ValidationError('Comment cannot be empty');
  }
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new ValidationError(`Comment cannot exceed ${COMMENT_BODY_MAX} characters`);
  }
  return trimmed;
}

export class CommentService {
  static async listForSubmission(submissionId: string): Promise<CommentRecord[]> {
    const submission = await SubmissionRepository.findById(submissionId);
    if (!submission) {
      throw new NotFoundError('Submission not found');
    }
    return CommentRepository.listBySubmissionId(submissionId);
  }

  static async create(input: {
    submissionId: string;
    authorId: string | null | undefined;
    body: string;
  }): Promise<CommentRecord> {
    if (!input.authorId) {
      throw new UnauthorizedError(
        'Unauthorized: Authentication required. Guest comment authorship is not specified.',
      );
    }
    const body = normalizeCommentBody(input.body);
    const submission = await SubmissionRepository.findById(input.submissionId);
    if (!submission) {
      throw new NotFoundError('Submission not found');
    }
    return CommentRepository.create({
      submissionId: input.submissionId,
      authorId: input.authorId,
      body,
    });
  }
}
