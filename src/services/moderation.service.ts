import {
  AuditAction,
  ContestStatus,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  AuditLogRecord,
  AuditLogRepository,
} from '../repositories/audit-log.repository.js';
import {
  ModerationQueueRecord,
  SubmissionRecord,
  SubmissionRepository,
} from '../repositories/submission.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';

/**
 * Moderation decisions (M07-P01-T04).
 *
 * Documented transitions leave PENDING_REVIEW only:
 *   PENDING_REVIEW → APPROVED | REJECTED | FLAGGED
 *
 * Reverse transitions, unflag, and FLAGGED → APPROVED/REJECTED are not
 * implemented. FLAGGED escalation details are NOT SPECIFIED.
 *
 * BR-CONT-05: COMPLETED and ARCHIVED contests are read-only, so moderation
 * writes are rejected. Other contest statuses are not additionally gated
 * (that constraint is NOT SPECIFIED).
 *
 * BR-VID-02: reject requires a non-empty reason. Optional reasonCode is
 * stored in audit metadata. Source chapters do not enumerate categories,
 * so reasonCode is not a closed allowlist.
 *
 * ISSUE_WARNING and SUSPEND_CREATOR exist on AuditAction and are not written
 * here. No warning or suspension API is part of M07.
 *
 * Flag is a service operation. M07 does not register an HTTP flag route.
 */

export interface ModerationActor {
  id: string;
  role: Role;
  organizationId: string | null;
}

export interface ModerationDecision {
  submission: SubmissionRecord;
  audit: AuditLogRecord;
}

const MODERATOR_ROLES = new Set<Role>([Role.BRAND_ADMIN, Role.SUPER_ADMIN]);

const CLOSED_CONTEST_STATUSES = new Set<ContestStatus>([
  ContestStatus.COMPLETED,
  ContestStatus.ARCHIVED,
]);

type TransactionClient = Prisma.TransactionClient;

type TransactionRunner = <T>(fn: (tx: TransactionClient) => Promise<T>) => Promise<T>;

let runTransaction: TransactionRunner = (fn) => prisma.$transaction(fn);

/** Test seam. Pass null to restore prisma.$transaction. */
export function setModerationTransactionRunner(runner: TransactionRunner | null): void {
  runTransaction = runner ?? ((fn) => prisma.$transaction(fn));
}

function assertModerator(actor: ModerationActor): void {
  if (!MODERATOR_ROLES.has(actor.role)) {
    throw new ForbiddenError(
      `Forbidden: User role '${actor.role}' does not have permission to access this resource`,
    );
  }
}

function assertTenant(actor: ModerationActor, organizationId: string): void {
  assertModerator(actor);
  if (actor.role === Role.SUPER_ADMIN) {
    return;
  }
  if (!actor.organizationId) {
    throw new ForbiddenError('Forbidden: Brand admin is not scoped to an organization');
  }
  if (actor.organizationId !== organizationId) {
    throw new ForbiddenError(
      'Forbidden: Submission does not belong to the authenticated organization',
    );
  }
}

function organizationFilter(actor: ModerationActor): string | undefined {
  assertModerator(actor);
  if (actor.role === Role.SUPER_ADMIN) {
    return undefined;
  }
  if (!actor.organizationId) {
    throw new ForbiddenError('Forbidden: Brand admin is not scoped to an organization');
  }
  return actor.organizationId;
}

function assertModeratable(submission: SubmissionRecord): void {
  if (CLOSED_CONTEST_STATUSES.has(submission.contest.status)) {
    throw new ConflictError('Closed contests are read-only historical records');
  }
  if (submission.status !== SubmissionStatus.PENDING_REVIEW) {
    throw new ConflictError(
      `Invalid submission status transition from ${submission.status}`,
    );
  }
}

async function decide(
  actor: ModerationActor,
  submissionId: string,
  action: AuditAction,
  nextStatus: SubmissionStatus,
  reason: string | null,
  reasonCode?: string,
): Promise<ModerationDecision> {
  const existing = await SubmissionRepository.findById(submissionId);
  if (!existing) {
    throw new NotFoundError('Submission not found');
  }
  assertTenant(actor, existing.contest.organizationId);
  assertModeratable(existing);

  const moderatedAt = new Date();
  const metadata: Record<string, string> = {
    previousStatus: existing.status,
    newStatus: nextStatus,
  };
  if (reasonCode) {
    metadata.reasonCode = reasonCode;
  }

  return runTransaction(async (tx) => {
    const submission = await SubmissionRepository.applyDecision(
      submissionId,
      {
        status: nextStatus,
        rejectionReason: nextStatus === SubmissionStatus.REJECTED ? reason : null,
        moderatedById: actor.id,
        moderatedAt,
      },
      tx,
    );
    const audit = await AuditLogRepository.create(
      {
        submissionId,
        actorId: actor.id,
        action,
        reason,
        metadata,
      },
      tx,
    );
    return { submission, audit };
  });
}

export class ModerationService {
  static async listQueue(actor: ModerationActor): Promise<ModerationQueueRecord[]> {
    return SubmissionRepository.listPendingReview(organizationFilter(actor));
  }

  static async listAuditLogs(actor: ModerationActor): Promise<AuditLogRecord[]> {
    return AuditLogRepository.list(organizationFilter(actor));
  }

  static async approve(actor: ModerationActor, submissionId: string, note?: string) {
    return decide(
      actor,
      submissionId,
      AuditAction.APPROVE,
      SubmissionStatus.APPROVED,
      note ?? null,
    );
  }

  static async reject(
    actor: ModerationActor,
    submissionId: string,
    reason: string,
    reasonCode?: string,
  ) {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new ValidationError('Rejection reason is required');
    }
    return decide(
      actor,
      submissionId,
      AuditAction.REJECT,
      SubmissionStatus.REJECTED,
      trimmed,
      reasonCode?.trim() || undefined,
    );
  }

  /**
   * Sets FLAGGED and writes AuditAction.FLAG.
   * No HTTP route is registered: the M07 API list does not include flag.
   * Escalation after FLAGGED is NOT SPECIFIED.
   */
  static async flag(actor: ModerationActor, submissionId: string, reason?: string) {
    const trimmed = reason?.trim();
    return decide(
      actor,
      submissionId,
      AuditAction.FLAG,
      SubmissionStatus.FLAGGED,
      trimmed ? trimmed : null,
    );
  }
}
