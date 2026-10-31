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
  parseThumbnailObjectKey,
  THUMBNAIL_CONTENT_TYPE,
  thumbnailKeyForSubmission,
} from './storage.service.js';
import { NotificationService } from './notification.service.js';
import { resolveSubmissionCategory } from './video-category.service.js';
import { PLEDGE_SERIES_SLUG } from './contest-schedule.js';
import { readStoredFormats } from './pledge-cycle-config.js';

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

interface UploadLimits {
  maxFileSizeBytes: number;
  maxDurationSeconds: number;
  allowedContentTypes: readonly string[];
}

function platformUploadLimits(): UploadLimits {
  return {
    maxFileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES,
    maxDurationSeconds: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS,
    allowedContentTypes: VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES,
  };
}

function uploadLimitsForContest(contest: {
  seriesSlug: string | null;
  cycleMonth: string | null;
  maxVideoSizeMb: number | null;
  maxVideoDurationSeconds: number | null;
  allowedVideoFormats: unknown;
}): UploadLimits {
  if (contest.seriesSlug !== PLEDGE_SERIES_SLUG || !contest.cycleMonth) {
    return platformUploadLimits();
  }
  if (
    !contest.maxVideoSizeMb ||
    !contest.maxVideoDurationSeconds ||
    contest.maxVideoSizeMb < 1 ||
    contest.maxVideoDurationSeconds < 1
  ) {
    throw new ValidationError('This Pledge month has no upload configuration');
  }
  const formats = readStoredFormats(contest.allowedVideoFormats) ?? [
    ...VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES,
  ];
  return {
    maxFileSizeBytes: contest.maxVideoSizeMb * 1024 * 1024,
    maxDurationSeconds: contest.maxVideoDurationSeconds,
    allowedContentTypes: formats,
  };
}

function assertVideoConstraints(
  input: {
    contentType?: string;
    fileSizeBytes?: number;
    durationSeconds: number;
  },
  limits: UploadLimits = platformUploadLimits(),
): void {
  if (
    input.contentType !== undefined &&
    !limits.allowedContentTypes.includes(input.contentType)
  ) {
    throw new ValidationError(VIDEO_CONTENT_TYPE_MESSAGE);
  }
  if (
    input.fileSizeBytes !== undefined &&
    (input.fileSizeBytes < 1 || input.fileSizeBytes > limits.maxFileSizeBytes)
  ) {
    throw new ValidationError(
      `fileSizeBytes must be between 1 and ${limits.maxFileSizeBytes}`,
    );
  }
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS ||
    input.durationSeconds > limits.maxDurationSeconds
  ) {
    throw new ValidationError(
      `durationSeconds must be an integer between ${VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS} and ${limits.maxDurationSeconds}`,
    );
  }
}

async function assertPledgeSingleSubmission(
  contest: { id: string; seriesSlug: string | null; cycleMonth: string | null },
  creatorId: string,
): Promise<void> {
  if (contest.seriesSlug !== PLEDGE_SERIES_SLUG || !contest.cycleMonth) return;
  const existing = await SubmissionRepository.findActiveByCreatorContest(
    creatorId,
    contest.id,
  );
  if (existing) {
    throw new ConflictError('You already submitted a Pledge entry for this month');
  }
}

function resolveVideoUrl(objectKey: string): string {
  const storage = getStorageService();
  if (storage.getPublicUrl) {
    return storage.getPublicUrl(objectKey);
  }
  return objectKey;
}

/**
 * A thumbnail object key is accepted only when it is the key paired with
 * this video. Stored http(s) URLs keep the previous behavior.
 */
function storedThumbnail(videoObjectKey: string, value: string | null | undefined) {
  if (!value) return null;
  if (!parseThumbnailObjectKey(value)) return value;
  if (value !== thumbnailKeyForSubmission(videoObjectKey)) {
    throw new ValidationError(
      'thumbnailUrl is not the thumbnail key issued for this video',
    );
  }
  return value;
}

export class SubmissionService {
  static async presign(actor: SubmissionActor, input: PresignSubmissionInput) {
    await assertCreator(actor);

    const contest = await ContestRepository.findById(input.contestId);
    if (!contest) {
      throw new NotFoundError('Contest not found');
    }
    if (contest.status !== 'ACTIVE') {
      throw new ValidationError(
        'Submissions are only accepted while the contest is ACTIVE',
      );
    }
    const limits = uploadLimitsForContest(contest);
    assertVideoConstraints(
      {
        contentType: input.contentType,
        fileSizeBytes: input.fileSizeBytes,
        durationSeconds: input.durationSeconds,
      },
      limits,
    );
    await assertPledgeSingleSubmission(contest, actor.id);

    const objectKey = buildSubmissionObjectKey({
      contestId: contest.id,
      creatorId: actor.id,
      contentType: input.contentType,
    });

    const storage = getStorageService();
    const signed = await storage.createPresignedUpload({
      objectKey,
      contentType: input.contentType,
      contentLength: input.fileSizeBytes,
    });
    const thumbnailKey = thumbnailKeyForSubmission(objectKey);
    const thumbnail = thumbnailKey
      ? await storage.createPresignedUpload({
          objectKey: thumbnailKey,
          contentType: THUMBNAIL_CONTENT_TYPE,
        })
      : null;

    return { ...signed, thumbnail };
  }

  static async complete(
    actor: SubmissionActor,
    input: CompleteSubmissionInput,
  ): Promise<{ submission: SubmissionRecord; created: boolean }> {
    await assertCreator(actor);

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
    const limits = uploadLimitsForContest(contest);
    assertVideoConstraints({ durationSeconds: input.durationSeconds }, limits);

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

    await assertPledgeSingleSubmission(contest, actor.id);
    const storage = getStorageService();
    if (storage.inspectUploadedObject) {
      const inspected = await storage.inspectUploadedObject(input.objectKey);
      if (inspected) {
        if (inspected.contentLength > limits.maxFileSizeBytes) {
          throw new ValidationError(
            `Uploaded video exceeds the configured size limit of ${limits.maxFileSizeBytes} bytes`,
          );
        }
        const uploadedType = inspected.contentType?.split(';')[0]?.trim();
        if (uploadedType && !limits.allowedContentTypes.includes(uploadedType)) {
          throw new ValidationError(VIDEO_CONTENT_TYPE_MESSAGE);
        }
      }
    }

    const category = await resolveSubmissionCategory(input);

    const data: CreateSubmissionData = {
      contestId: contest.id,
      creatorId: actor.id,
      title: input.title,
      description: input.description ?? null,
      videoUrl: resolveVideoUrl(input.objectKey),
      objectKey: input.objectKey,
      thumbnailUrl: storedThumbnail(input.objectKey, input.thumbnailUrl),
      durationSeconds: input.durationSeconds,
      tags: input.tags ?? [],
      categoryId: category.categoryId,
      otherCategoryLabel: category.otherCategoryLabel,
    };

    try {
      const submission = await SubmissionRepository.create(data, {
        onePledgeEntry:
          contest.seriesSlug === PLEDGE_SERIES_SLUG && Boolean(contest.cycleMonth),
      });
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
      await NotificationService.notifySubmissionPendingReview(submission);
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
