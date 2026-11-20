import { DatingGender, DatingIntention } from '@prisma/client';
import {
  DatingPreferencesWrite,
  DatingProfileRepository,
} from '../repositories/dating-profile.repository.js';
import { ValidationError } from '../utils/response.js';
import { requireDatingProfile } from './dating-access.js';
import { DATING_CONSUMPTION_HABITS } from './dating-constants.js';

const GENDERS = new Set<string>(Object.values(DatingGender));
const INTENTIONS = new Set<string>(Object.values(DatingIntention));
const HABITS = new Set<string>(DATING_CONSUMPTION_HABITS);

export function assertPreferenceBounds(
  input: Partial<DatingPreferencesWrite>,
  current?: DatingPreferencesWrite,
) {
  const minAge = input.minAge ?? current?.minAge ?? 18;
  const maxAge = input.maxAge ?? current?.maxAge ?? 99;
  const maxDistanceMiles = input.maxDistanceMiles ?? current?.maxDistanceMiles ?? 50;
  if (!Number.isInteger(minAge) || minAge < 18 || minAge > 99) {
    throw new ValidationError('minAge must be an integer from 18 to 99');
  }
  if (!Number.isInteger(maxAge) || maxAge < minAge || maxAge > 99) {
    throw new ValidationError('maxAge must be between minAge and 99');
  }
  if (
    !Number.isInteger(maxDistanceMiles) ||
    maxDistanceMiles < 5 ||
    maxDistanceMiles > 100
  ) {
    throw new ValidationError('maxDistanceMiles must be an integer from 5 to 100');
  }
  const genders = input.targetGenders ?? current?.targetGenders ?? [];
  for (const gender of genders) {
    if (!GENDERS.has(gender))
      throw new ValidationError('targetGenders contains an unsupported gender');
  }
  const habits = input.cannabisHabitsFilter ?? current?.cannabisHabitsFilter ?? [];
  for (const habit of habits) {
    if (!HABITS.has(habit))
      throw new ValidationError('cannabisHabitsFilter contains an unsupported habit');
  }
  const intentions = input.intentionsFilter ?? current?.intentionsFilter ?? [];
  for (const intention of intentions) {
    if (!INTENTIONS.has(intention)) {
      throw new ValidationError('intentionsFilter contains an unsupported intention');
    }
  }
}

export function toPreferenceView(preferences: DatingPreferencesWrite) {
  return {
    minAge: preferences.minAge,
    maxAge: preferences.maxAge,
    ageDealbreaker: preferences.ageDealbreaker,
    maxDistanceMiles: preferences.maxDistanceMiles,
    distanceDealbreaker: preferences.distanceDealbreaker,
    targetGenders: preferences.targetGenders,
    genderDealbreaker: preferences.genderDealbreaker,
    cannabisHabitsFilter: preferences.cannabisHabitsFilter,
    cannabisHabitsDealbreaker: preferences.cannabisHabitsDealbreaker,
    intentionsFilter: preferences.intentionsFilter,
    intentionsDealbreaker: preferences.intentionsDealbreaker,
    verifiedOnly: preferences.verifiedOnly,
  };
}

export class DatingPreferencesService {
  static async get(userId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    if (!profile.preferences) throw new ValidationError('Dating preferences are missing');
    return toPreferenceView(profile.preferences);
  }

  static async update(userId: string, input: Partial<DatingPreferencesWrite>) {
    const profile = await requireDatingProfile(userId);
    if (!profile.preferences) throw new ValidationError('Dating preferences are missing');
    assertPreferenceBounds(input, profile.preferences);
    const updated = await DatingProfileRepository.updatePreferences(profile.id, input);
    if (!updated.preferences) throw new ValidationError('Dating preferences are missing');
    return toPreferenceView(updated.preferences);
  }
}
