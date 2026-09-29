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

export async function toModerationSubmissionView(
  submission: SubmissionRecord | ModerationQueueRecord,
) {
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
          title: entry.submission.title,
          creatorName: entry.submission.creator?.name ?? null,
        }
      : null,
  };
}

export class ModerationController {
  /**
   * GET /api/v1/admin/moderation/queue
   */
  static async queue(request: FastifyRequest, reply: FastifyReply) {
    const submissions = await ModerationService.listQueue(actorFromRequest(request));
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
    const logs = await ModerationService.listAuditLogs(actorFromRequest(request));
    return sendSuccess(
      reply,
      logs.map(toAuditLogView),
      'Audit logs retrieved successfully',
      HTTP_STATUS.OK,
    );
  }
}
