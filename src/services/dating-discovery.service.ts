import { DatingProfileStatus, DatingVerificationStatus, Prisma } from '@prisma/client';
import { DatingDiscoveryRepository } from '../repositories/dating-match.repository.js';
import { DISCOVER_SCORE } from '../repositories/dating-discovery.query.js';
import { DatingProfileRecord } from '../repositories/dating-profile.repository.js';
import { ForbiddenError, ValidationError } from '../utils/response.js';
import { requireDatingProfile } from './dating-access.js';
import { birthDateBounds, boundingBox, distanceMiles } from './dating-geo.js';
import { presentPublicProfile } from './dating-profile.service.js';
import { datingPage } from './dating-view.js';

type PreferenceRow = NonNullable<DatingProfileRecord['preferences']>;

export function buildDiscoverWhere(input: {
  viewer: DatingProfileRecord;
  now?: Date;
}): Prisma.DatingProfileWhereInput {
  const preferences = input.viewer.preferences;
  if (!preferences) throw new ValidationError('Dating preferences are missing');
  const now = input.now ?? new Date();
  const where: Prisma.DatingProfileWhereInput = {
    id: { not: input.viewer.id },
    status: DatingProfileStatus.ACTIVE,
    NOT: {
      OR: [
        { likesReceived: { some: { senderProfileId: input.viewer.id } } },
        { matchesAsLow: { some: { profileHighId: input.viewer.id } } },
        { matchesAsHigh: { some: { profileLowId: input.viewer.id } } },
        { blocksInitiated: { some: { blockedProfileId: input.viewer.id } } },
        { blocksReceived: { some: { blockerProfileId: input.viewer.id } } },
      ],
    },
    OR: [
      { isIncognito: false },
      { likesSent: { some: { receiverProfileId: input.viewer.id, isPass: false } } },
    ],
  };
  const and: Prisma.DatingProfileWhereInput[] = [];
  if (preferences.ageDealbreaker) {
    const bounds = birthDateBounds(preferences.minAge, preferences.maxAge, now);
    and.push({
      birthDate: { gt: bounds.earliestExclusive, lte: bounds.latestInclusive },
    });
  }
  if (preferences.genderDealbreaker) {
    and.push({ gender: { in: preferences.targetGenders as never } });
  }
  if (
    preferences.cannabisHabitsDealbreaker &&
    preferences.cannabisHabitsFilter.length > 0
  ) {
    and.push({ consumptionHabits: { hasSome: preferences.cannabisHabitsFilter } });
  }
  if (preferences.intentionsDealbreaker && preferences.intentionsFilter.length > 0) {
    and.push({ datingIntention: { in: preferences.intentionsFilter as never } });
  }
  if (preferences.verifiedOnly) {
    and.push({ verificationStatus: DatingVerificationStatus.VERIFIED });
  }
  if (
    preferences.distanceDealbreaker &&
    input.viewer.latitudeFuzzy != null &&
    input.viewer.longitudeFuzzy != null
  ) {
    const box = boundingBox(
      input.viewer.latitudeFuzzy,
      input.viewer.longitudeFuzzy,
      preferences.maxDistanceMiles,
    );
    and.push({
      latitudeFuzzy: { gte: box.minLat, lte: box.maxLat },
      longitudeFuzzy: { gte: box.minLng, lte: box.maxLng },
    });
  }
  if (and.length > 0) where.AND = and;
  return where;
}

export function passesDistanceDealbreaker(
  viewer: DatingProfileRecord,
  candidate: DatingProfileRecord,
): boolean {
  const preferences = viewer.preferences;
  if (!preferences?.distanceDealbreaker) return true;
  if (viewer.latitudeFuzzy == null || viewer.longitudeFuzzy == null) return true;
  if (candidate.latitudeFuzzy == null || candidate.longitudeFuzzy == null) return false;
  return (
    distanceMiles(
      viewer.latitudeFuzzy,
      viewer.longitudeFuzzy,
      candidate.latitudeFuzzy,
      candidate.longitudeFuzzy,
    ) <= preferences.maxDistanceMiles
  );
}

export function preferenceScore(
  preferences: PreferenceRow,
  candidate: DatingProfileRecord,
): number {
  let score = 0;
  if (preferences.targetGenders.includes(candidate.gender))
    score += DISCOVER_SCORE.gender;
  if (preferences.intentionsFilter.includes(candidate.datingIntention))
    score += DISCOVER_SCORE.intention;
  if (
    preferences.cannabisHabitsFilter.length === 0 ||
    candidate.consumptionHabits.some((habit) =>
      preferences.cannabisHabitsFilter.includes(habit),
    )
  ) {
    score += DISCOVER_SCORE.habit;
  }
  if (
    !preferences.verifiedOnly &&
    candidate.verificationStatus === DatingVerificationStatus.VERIFIED
  ) {
    score += DISCOVER_SCORE.verified;
  }
  return score;
}

export class DatingDiscoveryService {
  static async discover(userId: string, page: number, limit: number) {
    const viewer = await requireDatingProfile(userId);
    if (viewer.status !== DatingProfileStatus.ACTIVE) {
      throw new ForbiddenError('Activate your dating profile before discovering people');
    }
    const window = await DatingDiscoveryRepository.searchRanked({
      viewer,
      skip: (page - 1) * limit,
      take: limit,
    });
    const items = await Promise.all(
      window.rows.map((row) => presentPublicProfile(row, viewer)),
    );
    return datingPage(items, window.total, page, limit);
  }
}
