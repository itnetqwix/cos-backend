import { DatingProfileStatus, Prisma } from '@prisma/client';
import { DatingProfileRepository } from '../repositories/dating-profile.repository.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/response.js';

export async function requireDatingProfile(
  userId: string,
  options?: { allowBanned?: boolean },
) {
  const profile = await DatingProfileRepository.findByUserId(userId);
  if (!profile) throw new NotFoundError('Dating profile not found');
  if (!options?.allowBanned && profile.status === DatingProfileStatus.BANNED) {
    throw new ForbiddenError('Your 420 Dating profile is banned');
  }
  return profile;
}

export function rethrowDatingWrite(error: unknown, conflictMessage: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new ConflictError(conflictMessage);
    if (error.code === 'P2003') {
      throw new ConflictError(
        'This dating profile cannot be deleted while abuse reports reference it. Pause the profile instead.',
      );
    }
  }
  throw error;
}
