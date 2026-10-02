import { CreatorActivityAction, Prisma } from '@prisma/client';
import {
  CreatorActivityRepository,
  type CreateCreatorActivityData,
} from '../repositories/creator-activity.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Persistent creator timeline.
 *
 * A failed write is logged and does not roll back the creator or admin action
 * that already succeeded. Passwords, tokens, and authorization material are
 * dropped before insert.
 */

const SENSITIVE_KEY = /password|token|jwt|secret|authorization|cookie/i;

const DEFAULT_DESCRIPTION: Record<CreatorActivityAction, string> = {
  REGISTERED: 'Creator registered',
  LOGGED_IN: 'Creator logged in',
  SUBMISSION_UPLOADED: 'Submission upload completed',
  SUBMISSION_APPROVED: 'Submission approved',
  SUBMISSION_REJECTED: 'Submission rejected',
  SUBMISSION_FLAGGED: 'Submission flagged',
  SUBMISSION_DELETED: 'Submission deleted',
  BLOCKED: 'Creator blocked',
  UNBLOCKED: 'Creator unblocked',
  WARNED: 'Creator warned',
};

export interface RecordCreatorActivityInput {
  creatorId: string;
  action: CreatorActivityAction;
  description?: string;
  metadata?: Record<string, unknown> | null;
  relatedSubmissionId?: string | null;
  relatedContestId?: string | null;
  performedByUserId?: string | null;
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) clean[key] = trimmed.slice(0, 500);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export class CreatorActivityService {
  static async record(input: RecordCreatorActivityInput): Promise<void> {
    const data: CreateCreatorActivityData = {
      creatorId: input.creatorId,
      action: input.action,
      description: (input.description ?? DEFAULT_DESCRIPTION[input.action]).slice(0, 500),
      metadata: sanitizeMetadata(input.metadata),
      relatedSubmissionId: input.relatedSubmissionId ?? null,
      relatedContestId: input.relatedContestId ?? null,
      performedByUserId: input.performedByUserId ?? null,
    };

    try {
      await CreatorActivityRepository.create(data);
    } catch (error) {
      logger.error('creator activity log failed', error);
    }
  }
}
