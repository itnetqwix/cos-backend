import { AccountStatus, Role } from '@prisma/client';
import { UserRepository } from '../repositories/user.repository.js';
import { ForbiddenError } from '../utils/response.js';

export const CREATOR_BLOCKED_MESSAGE = 'Forbidden: This creator account is blocked';

/**
 * Single account-status check for creator-only actions.
 *
 * A missing user row is not treated as blocked: creator routes for unknown
 * ids still fail later on ownership and foreign keys. A stored BLOCKED
 * creator is rejected. ADMIN rows are not blocked here.
 */
export async function assertCreatorAccountActive(userId: string): Promise<void> {
  const account = await UserRepository.findAccountGate(userId);
  if (!account || account.role !== Role.CREATOR) return;
  if (account.accountStatus === AccountStatus.BLOCKED) {
    throw new ForbiddenError(CREATOR_BLOCKED_MESSAGE);
  }
}
