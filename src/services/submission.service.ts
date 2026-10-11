import { CreatorActivityAction, Prisma, Role, SubmissionStatus } from '@prisma/client';
import { VIDEO_CONSTRAINTS, VIDEO_CONTENT_TYPE_MESSAGE } from '../config/constants.js';
import { ContestRepository } from '../repositories/contest.repository.js';
import {
  CreateSubmissionData,
  SubmissionRecord,
  SubmissionRepository,
} from '../repositories/submission.repository.js';
import {
  CompleteSubmissionInput,
  PresignSubmissionInput,
} from '../schemas/submission.schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import { assertCreatorAccountActive } from './creator-account.service.js';
import { CreatorActivityService } from './creator-activity.service.js';
import {
  buildSubmissionObjectKey,
  getStorageService,
  isAllowedVideoContentType,
  parseSubmissionObjectKey,
} from './storage.service.js';

/**
 * Creator submission ingest (M06-P03-T02).
 *
 * POST presign / complete / GET me / GET :id are CREATOR only.
 * Max submissions per creator per contest: NOT SPECIFIED (not enforced).
 * Date-window checks beyond status ACTIVE: NOT SPECIFIED (ACTIVE is the gate).
 * ADMIN cannot submit or read these creator routes.
 */

export interface SubmissionActor {
  id: string;
  role: Role;
}

const CREATOR_ONLY_MESSAGE =
  'Forbidden: User role does not have permission to access this resource';

async function assertCreator(actor: SubmissionActor): Promise<void> {
  if (actor.role !== Role.CREATOR) {
    throw new ForbiddenError(CREATOR_ONLY_MESSAGE);
  }
  await assertCreatorAccountActive(actor.id);
}

function assertVideoConstraints(input: {
  contentType?: string;
  fileSizeBytes?: number;
  durationSeconds: number;
}): void {
  if (input.contentType !== undefined && !isAllowedVideoContentType(input.contentType)) {
    throw new ValidationError(VIDEO_CONTENT_TYPE_MESSAGE);
  }
  if (
    input.fileSizeBytes !== undefined &&
    (input.fileSizeBytes < 1 ||
      input.fileSizeBytes > VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES)
  ) {
    throw new ValidationError(
      `fileSizeBytes must be between 1 and ${VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES}`,
    );
  }
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS ||
    input.durationSeconds > VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS
  ) {
    throw new ValidationError(
      `durationSeconds must be an integer between ${VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS} and ${VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS}`,
    );
  }
}

function resolveVideoUrl(objectKey: string): string {
  const storage = getStorageService();
  if (storage.getPublicUrl) {
    return storage.getPublicUrl(objectKey);
  }
  return objectKey;
}

export class SubmissionService {
  static async presign(actor: SubmissionActor, input: PresignSubmissionInput) {
    await assertCreator(actor);
    assertVideoConstraints({
      contentType: input.contentType,
      fileSizeBytes: input.fileSizeBytes,
      durationSeconds: input.durationSeconds,
    });

    const contest = await ContestRepository.findById(input.contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    if (contest.status !== 'ACTIVE') {
      throw new ValidationError(
        'Submissions are only accepted while the contest is ACTIVE',
      );
    }

    const objectKey = buildSubmissionObjectKey({
      contestId: contest.id,
      creatorId: actor.id,
      contentType: input.contentType,
    });

    const signed = await getStorageService().createPresignedUpload({
      objectKey,
      contentType: input.contentType,
    });

    return signed;
  }

  static async complete(
    actor: SubmissionActor,
    input: CompleteSubmissionInput,
  ): Promise<{ submission: SubmissionRecord; created: boolean }> {
    await assertCreator(actor);
    assertVideoConstraints({ durationSeconds: input.durationSeconds });

    const parsed = parseSubmissionObjectKey(input.objectKey);
    if (!parsed) {
      throw new ValidationError('objectKey is not a backend-issued submission key');
    }
    if (parsed.creatorId !== actor.id) {
      throw new ForbiddenError(
        'Forbidden: objectKey does not belong to the authenticated creator',
      );
    }
    if (parsed.contestId !== input.contestId) {
      throw new ValidationError('objectKey contest does not match contestId');
    }

    const contest = await ContestRepository.findById(input.contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    if (contest.status !== 'ACTIVE') {
      throw new ValidationError(
        'Submissions are only accepted while the contest is ACTIVE',
      );
    }

    const existing = await SubmissionRepository.findByObjectKey(input.objectKey);
    if (existing) {
      if (existing.deletedAt) {
        throw new ConflictError('objectKey is already registered');
      }
      if (existing.creatorId === actor.id) {
        return { submission: existing, created: false };
      }
      throw new ConflictError('objectKey is already registered');
    }

    const data: CreateSubmissionData = {
      contestId: contest.id,
      creatorId: actor.id,
      title: input.title,
      description: input.description ?? null,
      videoUrl: resolveVideoUrl(input.objectKey),
      objectKey: input.objectKey,
      thumbnailUrl: input.thumbnailUrl ?? null,
      durationSeconds: input.durationSeconds,
      tags: input.tags ?? [],
    };

    try {
      const submission = await SubmissionRepository.create(data);
      await CreatorActivityService.record({
        creatorId: actor.id,
        action: CreatorActivityAction.SUBMISSION_UPLOADED,
        description: 'Submission upload completed',
        relatedSubmissionId: submission.id,
        relatedContestId: submission.contestId,
        performedByUserId: actor.id,
        metadata: {
          submissionTitle: submission.title,
          contestTitle: submission.contest.title,
        },
      });
      return { submission, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await SubmissionRepository.findByObjectKey(input.objectKey);
        if (raced && !raced.deletedAt && raced.creatorId === actor.id) {
          return { submission: raced, created: false };
        }
        throw new ConflictError('objectKey is already registered');
      }
      throw error;
    }
  }

  static async listMine(actor: SubmissionActor): Promise<SubmissionRecord[]> {
    await assertCreator(actor);
    return SubmissionRepository.listByCreatorId(actor.id);
  }

  static async getById(actor: SubmissionActor, id: string): Promise<SubmissionRecord> {
    await assertCreator(actor);
    const submission = await SubmissionRepository.findById(id);
    if (!submission || submission.creatorId !== actor.id || submission.deletedAt) {
      throw new NotFoundError('Submission not found');
    }
    return submission;
  }

  /**
   * Creator soft delete. Another creator's id is 404.
   * A second delete of the same row succeeds and keeps the original timestamp.
   * Ratings, the submission row, and the S3 object are not removed.
   */
  static async remove(actor: SubmissionActor, id: string) {
    await assertCreator(actor);
    const existing = await SubmissionRepository.findById(id);
    if (!existing || existing.creatorId !== actor.id) {
      throw new NotFoundError('Submission not found');
    }
    if (existing.deletedAt) {
      return {
        id: existing.id,
        deleted: true,
        deletedAt: existing.deletedAt,
      };
    }
    const deleted = await SubmissionRepository.softDeleteOwned(id, actor.id);
    const row = deleted ?? (await SubmissionRepository.findById(id));
    if (!row || row.creatorId !== actor.id || !row.deletedAt) {
      throw new NotFoundError('Submission not found');
    }
    if (deleted) {
      await CreatorActivityService.record({
        creatorId: actor.id,
        action: CreatorActivityAction.SUBMISSION_DELETED,
        description: 'Submission deleted by creator',
        relatedSubmissionId: row.id,
        relatedContestId: row.contestId,
        performedByUserId: actor.id,
        metadata: {
          submissionTitle: row.title,
          contestTitle: row.contest.title,
        },
      });
    }
    return {
      id: row.id,
      deleted: true,
      deletedAt: row.deletedAt,
    };
  }
}

export const INITIAL_SUBMISSION_STATUS = SubmissionStatus.PENDING_REVIEW;
