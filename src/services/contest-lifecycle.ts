import { ContestStatus } from '@prisma/client';
import { ConflictError } from '../utils/response.js';

/**
 * Contest lifecycle (M05-P02-T03 / T04, M05-P05).
 *
 * Documented forward path only (master plan + domain rule 02):
 * DRAFT → SCHEDULED → ACTIVE → JUDGING → COMPLETED → ARCHIVED.
 *
 * Not implemented, because they are NOT SPECIFIED:
 * - CANCELLED (master plan: triggers NOT SPECIFIED; not a persisted status)
 * - suspension / pause
 * - skipping a status, moving backward, or reopening
 * - automatic time-based transitions (no cron)
 *
 * BR-CONT-04: once status is ACTIVE, settings, category, and rules cannot
 * change. JUDGING is after that transition, so the lock continues.
 * BR-CONT-05: COMPLETED and ARCHIVED are read-only except the documented
 * COMPLETED → ARCHIVED step.
 *
 * DRAFT and SCHEDULED remain editable. The domain-model sentence
 * "SCHEDULED: Contest parameters locked" is not applied as a write lock:
 * M05-P02-T04 and BR-CONT-04 place the lock at ACTIVE.
 */

const NEXT_STATUS: Record<ContestStatus, ContestStatus | null> = {
  DRAFT: ContestStatus.SCHEDULED,
  SCHEDULED: ContestStatus.ACTIVE,
  ACTIVE: ContestStatus.JUDGING,
  JUDGING: ContestStatus.COMPLETED,
  COMPLETED: ContestStatus.ARCHIVED,
  ARCHIVED: null,
};

export const CONFIGURATION_MUTABLE_STATUSES: ReadonlySet<ContestStatus> = new Set([
  ContestStatus.DRAFT,
  ContestStatus.SCHEDULED,
]);

export function nextContestStatus(status: ContestStatus): ContestStatus | null {
  return NEXT_STATUS[status];
}

export function assertContestTransition(from: ContestStatus, to: ContestStatus): void {
  const allowed = NEXT_STATUS[from];
  if (to !== allowed) {
    throw new ConflictError(`Invalid contest status transition from ${from} to ${to}`);
  }
}

/**
 * Reject configuration writes when the contest is already ACTIVE or later.
 * `rules` is the persisted rules document. There is no evaluation-criteria
 * column (NOT SPECIFIED); category changes are the category half of BR-CONT-04.
 */
export function assertContestConfigurationMutable(status: ContestStatus): void {
  if (CONFIGURATION_MUTABLE_STATUSES.has(status)) {
    return;
  }

  if (status === ContestStatus.COMPLETED || status === ContestStatus.ARCHIVED) {
    throw new ConflictError('Closed contests are read-only historical records');
  }

  throw new ConflictError(
    'Contest settings, categories, and evaluation criteria cannot be modified once a contest is ACTIVE',
  );
}
