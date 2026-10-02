import { Role } from '@prisma/client';
import { UserRepository } from '../repositories/user.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { playbackUrlForSubmission } from './storage.service.js';
import { ForbiddenError, NotFoundError } from '../utils/response.js';

/**
 * Admin directory of creator accounts and their submissions.
 *
 * ADMIN only. A creator cannot use these operations, including delete.
 * Delete removes the submission row. Ratings and comments cascade.
 * The creator account, contest, and other submissions stay.
 * The stored S3 object is not deleted: the storage port has no delete
 * operation, and this service does not invent one.
 */

export interface AdminActor {
  id: string;
  role: Role;
}

function assertAdmin(actor: AdminActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError(
      `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
    );
  }
}

export class AdminCreatorService {
  static async list(actor: AdminActor) {
    assertAdmin(actor);
    const { users, totalCreators } = await UserRepository.listCreators();
    return {
      totalCreators,
      creators: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        submissionCount: user._count.submissions,
      })),
    };
  }

  static async getProfile(actor: AdminActor, creatorId: string) {
    assertAdmin(actor);
    const creator = await UserRepository.findCreatorById(creatorId);
    if (!creator) {
      throw new NotFoundError('Creator not found');
    }
    const submissions = await SubmissionRepository.listByCreatorId(creatorId);
    const videos = await Promise.all(
      submissions.map(async (submission) => ({
        id: submission.id,
        title: submission.title,
        status: submission.status,
        createdAt: submission.createdAt,
        contestId: submission.contestId,
        contestTitle: submission.contest.title,
        contestStatus: submission.contest.status,
        communityScore: submission.communityScore,
        totalVotes: submission.totalVotes,
        durationSeconds: submission.durationSeconds,
        videoUrl: await playbackUrlForSubmission(
          submission.objectKey,
          submission.videoUrl,
        ),
      })),
    );
    return {
      creator: {
        id: creator.id,
        name: creator.name,
        email: creator.email,
        role: creator.role,
        createdAt: creator.createdAt,
      },
      submissions: videos,
    };
  }

  static async deleteSubmission(actor: AdminActor, submissionId: string) {
    assertAdmin(actor);
    const existing = await SubmissionRepository.findById(submissionId);
    if (!existing) {
      throw new NotFoundError('Submission not found');
    }
    await SubmissionRepository.deleteById(submissionId);
    return {
      id: submissionId,
      deleted: true,
      mediaObjectRetained: true,
    };
  }
}
