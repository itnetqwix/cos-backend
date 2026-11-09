import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { AuditLogRecord } from '../repositories/audit-log.repository.js';
import {
  ModerationQueueRecord,
  SubmissionRecord,
} from '../repositories/submission.repository.js';
import {
  approveSubmissionSchema,
  rejectSubmissionSchema,
  submissionIdParamSchema,
} from '../schemas/moderation.schema.js';
import { ModerationService } from '../services/moderation.service.js';
import { resolveSubmissionMedia } from '../services/storage.service.js';
import { NotFoundError, sendSuccess } from '../utils/response.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { VideoDomain } from '@prisma/client';

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

export async function toModerationSubmissionView(
  submission: SubmissionRecord | ModerationQueueRecord,
) {
  const media = await resolveSubmissionMedia(
    submission.objectKey,
    submission.videoUrl,
    submission.thumbnailUrl,
    { audience: 'restricted', expiresInSeconds: 3600 },
  );
  return {
    id: submission.id,
    contestId: submission.contestId,
    creatorId: submission.creatorId,
    title: submission.title,
    description: submission.description,
    videoUrl: media.videoUrl,
    objectKey: submission.objectKey,
    thumbnailUrl: media.thumbnailUrl,
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
    creator:
      'creator' in submission && submission.creator
        ? { id: submission.creator.id, name: submission.creator.name }
        : undefined,
  };
}

export function toAuditLogView(entry: AuditLogRecord) {
  return {
    id: entry.id,
    submissionId: entry.submissionId,
    actorId: entry.actorId,
    action: entry.action,
    reason: entry.reason,
    metadata: entry.metadata,
    createdAt: iso(entry.createdAt),
    actor: entry.actor,
    submission: entry.submission
      ? {
          id: entry.submission.id,
          contestId: entry.submission.contestId,
          title: entry.submission.title,
          creatorName: entry.submission.creator?.name ?? null,
          contest: entry.submission.contest,
        }
      : null,
  };
}

export class ModerationController {
  /**
   * GET /api/v1/admin/moderation/queue
   */
  static async queue(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query || {}) as {
      contestId?: string;
      seriesSlug?: string;
      domain?: VideoDomain;
    };
    const domain =
      query.seriesSlug === 'pledge'
        ? VideoDomain.PLEDGE
        : (query.domain ?? (query.seriesSlug ? undefined : VideoDomain.REGULAR));
    const submissions = await ModerationService.listQueue(actorFromRequest(request), {
      ...query,
      domain,
    });
    return sendSuccess(
      reply,
      await Promise.all(
        submissions.map((submission) => toModerationSubmissionView(submission)),
      ),
      'Moderation queue retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/admin/submissions/:id/approve
   */
  static async approve(request: FastifyRequest, reply: FastifyReply) {
    const { id } = submissionIdParamSchema.parse(request.params);
    const body = approveSubmissionSchema.parse(request.body ?? {});
    const { submission } = await ModerationService.approve(
      actorFromRequest(request),
      id,
      body.note,
      VideoDomain.REGULAR,
    );
    return sendSuccess(
      reply,
      await toModerationSubmissionView(submission),
      'Submission approved',
      HTTP_STATUS.OK,
    );
  }

  /**
   * POST /api/v1/admin/submissions/:id/reject
   */
  static async reject(request: FastifyRequest, reply: FastifyReply) {
    const { id } = submissionIdParamSchema.parse(request.params);
    const body = rejectSubmissionSchema.parse(request.body ?? {});
    const { submission } = await ModerationService.reject(
      actorFromRequest(request),
      id,
      body.reason,
      body.reasonCode,
      VideoDomain.REGULAR,
    );
    return sendSuccess(
      reply,
      await toModerationSubmissionView(submission),
      'Submission rejected',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/moderation/audit-logs
   */
  static async auditLogs(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query || {}) as {
      contestId?: string;
      seriesSlug?: string;
      domain?: VideoDomain;
    };
    const domain =
      query.seriesSlug === 'pledge'
        ? VideoDomain.PLEDGE
        : (query.domain ?? (query.seriesSlug ? undefined : VideoDomain.REGULAR));
    const logs = await ModerationService.listAuditLogs(actorFromRequest(request), {
      ...query,
      domain,
    });
    return sendSuccess(
      reply,
      logs.map(toAuditLogView),
      'Audit logs retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * GET /api/v1/admin/submissions/:id/playback-url
   */
  static async playbackUrl(request: FastifyRequest, reply: FastifyReply) {
    const { id } = submissionIdParamSchema.parse(request.params);
    const submission = await SubmissionRepository.findById(id);
    if (!submission || submission.domain !== VideoDomain.REGULAR) {
      throw new NotFoundError('Submission not found');
    }
    const media = await resolveSubmissionMedia(
      submission.objectKey,
      submission.videoUrl,
      submission.thumbnailUrl,
      { audience: 'restricted', expiresInSeconds: 3600 },
    );
    return sendSuccess(reply, media, 'Playback URL retrieved', HTTP_STATUS.OK);
  }
}
