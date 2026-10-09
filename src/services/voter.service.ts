import { SubmissionStatus } from '@prisma/client';
import { RatingRepository } from '../repositories/rating.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { signedAvatarUrl } from './storage.service.js';
import { NotFoundError } from '../utils/response.js';

/**
 * Public voter list for one approved submission.
 *
 * Ratings are the source of votes. Guest rows have no user and are returned
 * with name null. Email, password, IP hash, and fingerprint are not returned.
 * List order is newest first. A product sort is NOT SPECIFIED.
 */

export interface PublicVoter {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  rating: number;
  createdAt: string;
}

export class VoterService {
  static async listForSubmission(
    submissionId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PublicVoter[]; total: number }> {
    const submission = await SubmissionRepository.findById(submissionId);
    if (!submission || submission.status !== SubmissionStatus.APPROVED) {
      throw new NotFoundError('Submission not found');
    }

    const skip = (page - 1) * limit;
    const { total, rows } = await RatingRepository.listForSubmission(
      submissionId,
      skip,
      limit,
    );
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.user?.name ?? null,
        avatarUrl: row.user ? await signedAvatarUrl(row.user.avatarObjectKey) : null,
        rating: row.rating,
        createdAt: row.createdAt.toISOString(),
      })),
    );
    return { items, total };
  }
}
