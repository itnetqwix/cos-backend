import {
  CannabisExperienceLevel,
  DatingGender,
  DatingIntention,
  DatingNotificationType,
  DatingProfileStatus,
  DatingVerificationStatus,
  Prisma,
} from '@prisma/client';
import {
  DatingPreferencesWrite,
  DatingProfileRecord,
  DatingProfileRepository,
  DatingProfileWrite,
} from '../repositories/dating-profile.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import { requireDatingProfile, rethrowDatingWrite } from './dating-access.js';
import {
  DATING_BIO_MAX,
  DATING_CONSUMPTION_HABITS,
  DATING_DISPLAY_NAME_MAX,
  DATING_MAX_PROMPTS,
  DATING_METHODS,
} from './dating-constants.js';
import { assertLegalAge, fuzzCoordinates, parseBirthDate } from './dating-geo.js';
import { DatingNotificationRepository } from '../repositories/dating-safety.repository.js';
import { assertDatingTextsAllowed } from './dating-policy.js';
import {
  assertDatingImageSize,
  buildDatingVerificationPhotoKey,
  getStorageService,
  parseDatingVerificationPhotoKey,
  signedDatingPhotoUrl,
} from './storage.service.js';
import {
  assertPublicProfileHasNoSecrets,
  presentNarrative,
  readPrompts,
  DatingPrompt,
} from './dating-view.js';

const GENDERS = new Set<string>(Object.values(DatingGender));
const INTENTIONS = new Set<string>(Object.values(DatingIntention));
const EXPERIENCE = new Set<string>(Object.values(CannabisExperienceLevel));
const HABITS = new Set<string>(DATING_CONSUMPTION_HABITS);
const METHODS = new Set<string>(DATING_METHODS);

export interface DatingOnboardingInput {
  displayName: string;
  birthDate: string;
  ageConfirmed: boolean;
  gender: DatingGender;
  interestedIn: DatingGender[];
  datingIntention?: DatingIntention;
  consumptionHabits?: string[];
  favoriteStrains?: string[];
  cannabisExperienceLevel?: CannabisExperienceLevel;
  favoriteMethods?: string[];
  lifestyleInterests?: string[];
  bio?: string | null;
  city: string;
  state: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  prompts?: DatingPrompt[];
  isIncognito?: boolean;
  isDistanceHidden?: boolean;
  isAgeHidden?: boolean;
  preferences?: Partial<DatingPreferencesWrite>;
}

function assertList(
  values: string[] | undefined,
  allowed: Set<string>,
  label: string,
  max: number,
) {
  const list = values ?? [];
  if (list.length > max)
    throw new ValidationError(`${label} accepts at most ${max} values`);
  for (const value of list) {
    if (!allowed.has(value))
      throw new ValidationError(`${label} contains an unsupported value`);
  }
  return list;
}

function assertGenders(values: string[], label: string): DatingGender[] {
  if (values.length === 0)
    throw new ValidationError(`${label} requires at least one gender`);
  for (const value of values) {
    if (!GENDERS.has(value))
      throw new ValidationError(`${label} contains an unsupported gender`);
  }
  return values as DatingGender[];
}

export function normalizePrompts(prompts: DatingPrompt[] | undefined): DatingPrompt[] {
  const list = prompts ?? [];
  if (list.length > DATING_MAX_PROMPTS) {
    throw new ValidationError('A dating profile can have at most 3 prompts');
  }
  const seen = new Set<string>();
  return list.map((prompt) => {
    const promptId = prompt.promptId.trim();
    const question = prompt.question.trim();
    const answer = prompt.answer.trim();
    if (!promptId || promptId.length > 64)
      throw new ValidationError('promptId is invalid');
    if (!question || question.length > 160)
      throw new ValidationError('Prompt question is invalid');
    if (!answer || answer.length > 280)
      throw new ValidationError('Prompt answer is invalid');
    if (seen.has(promptId)) throw new ValidationError('Prompt ids must be unique');
    seen.add(promptId);
    assertDatingTextsAllowed([question, answer]);
    return { promptId, question, answer };
  });
}

function defaultPreferences(
  interestedIn: string[],
  overrides?: Partial<DatingPreferencesWrite>,
): DatingPreferencesWrite {
  return {
    minAge: overrides?.minAge ?? 18,
    maxAge: overrides?.maxAge ?? 99,
    ageDealbreaker: overrides?.ageDealbreaker ?? false,
    maxDistanceMiles: overrides?.maxDistanceMiles ?? 50,
    distanceDealbreaker: overrides?.distanceDealbreaker ?? false,
    targetGenders: overrides?.targetGenders ?? interestedIn,
    genderDealbreaker: overrides?.genderDealbreaker ?? false,
    cannabisHabitsFilter: overrides?.cannabisHabitsFilter ?? [],
    cannabisHabitsDealbreaker: overrides?.cannabisHabitsDealbreaker ?? false,
    intentionsFilter: overrides?.intentionsFilter ?? [],
    intentionsDealbreaker: overrides?.intentionsDealbreaker ?? false,
    verifiedOnly: overrides?.verifiedOnly ?? false,
  };
}

export function buildProfileWrite(
  userId: string,
  input: DatingOnboardingInput,
  random: () => number = Math.random,
): DatingProfileWrite {
  if (input.ageConfirmed !== true) {
    throw new ValidationError('You must confirm that you are at least 18 years old');
  }
  const birthDate = parseBirthDate(input.birthDate);
  assertLegalAge(birthDate);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > DATING_DISPLAY_NAME_MAX) {
    throw new ValidationError('displayName must be 1 to 40 characters');
  }
  const bio = input.bio?.trim() ? input.bio.trim() : null;
  if (bio && bio.length > DATING_BIO_MAX) throw new ValidationError('bio is too long');
  const city = input.city.trim();
  const state = input.state.trim();
  const country = (input.country ?? 'USA').trim() || 'USA';
  if (!city || city.length > 80 || !state || state.length > 80 || country.length > 80) {
    throw new ValidationError('city, state, and country are required');
  }
  if (!GENDERS.has(input.gender)) throw new ValidationError('gender is unsupported');
  const interestedIn = assertGenders(input.interestedIn, 'interestedIn');
  const datingIntention = input.datingIntention ?? DatingIntention.NOT_SURE;
  if (!INTENTIONS.has(datingIntention))
    throw new ValidationError('datingIntention is unsupported');
  const experience =
    input.cannabisExperienceLevel ?? CannabisExperienceLevel.CASUAL_PUFFER;
  if (!EXPERIENCE.has(experience))
    throw new ValidationError('cannabisExperienceLevel is unsupported');
  const strains = (input.favoriteStrains ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (strains.length > 12 || strains.some((item) => item.length > 40)) {
    throw new ValidationError('favoriteStrains accepts at most 12 short names');
  }
  const interests = (input.lifestyleInterests ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (interests.length > 12 || interests.some((item) => item.length > 40)) {
    throw new ValidationError('lifestyleInterests accepts at most 12 short tags');
  }
  const prompts = normalizePrompts(input.prompts);
  assertDatingTextsAllowed([displayName, bio, ...strains, ...interests]);
  let latitudeFuzzy: number | null = null;
  let longitudeFuzzy: number | null = null;
  const hasLat = input.latitude !== undefined;
  const hasLng = input.longitude !== undefined;
  if (hasLat !== hasLng)
    throw new ValidationError('latitude and longitude must be sent together');
  if (hasLat && hasLng && input.latitude !== undefined && input.longitude !== undefined) {
    const fuzzy = fuzzCoordinates(input.latitude, input.longitude, random);
    latitudeFuzzy = fuzzy.latitudeFuzzy;
    longitudeFuzzy = fuzzy.longitudeFuzzy;
  }
  return {
    userId,
    displayName,
    birthDate,
    gender: input.gender,
    interestedIn,
    bio,
    datingIntention,
    consumptionHabits: assertList(
      input.consumptionHabits,
      HABITS,
      'consumptionHabits',
      6,
    ),
    favoriteStrains: strains,
    cannabisExperienceLevel: experience,
    favoriteMethods: assertList(input.favoriteMethods, METHODS, 'favoriteMethods', 8),
    lifestyleInterests: interests,
    city,
    state,
    country,
    latitudeFuzzy,
    longitudeFuzzy,
    profilePrompts: prompts,
    isIncognito: input.isIncognito ?? false,
    isDistanceHidden: input.isDistanceHidden ?? false,
    isAgeHidden: input.isAgeHidden ?? false,
    preferences: defaultPreferences(interestedIn, input.preferences),
  };
}

async function sign(objectKey: string) {
  return signedDatingPhotoUrl(objectKey);
}

export async function presentOwnProfile(profile: DatingProfileRecord) {
  const narrative = await presentNarrative(profile, {
    viewer: null,
    revealAge: true,
    revealDistance: false,
    sign,
    includeUnapprovedPhotos: true,
  });
  const payload = {
    ...narrative,
    userId: profile.userId,
    status: profile.status,
    interestedIn: profile.interestedIn,
    isIncognito: profile.isIncognito,
    isDistanceHidden: profile.isDistanceHidden,
    isAgeHidden: profile.isAgeHidden,
    prompts: readPrompts(profile.profilePrompts),
  };
  assertPublicProfileHasNoSecrets(payload, 'owner');
  return payload;
}

export async function presentPublicProfile(
  profile: DatingProfileRecord,
  viewer: DatingProfileRecord | null,
) {
  const hideAge = profile.isAgeHidden && viewer?.id !== profile.id;
  const hideDistance = profile.isDistanceHidden && viewer?.id !== profile.id;
  const payload = await presentNarrative(profile, {
    viewer: viewer
      ? {
          city: viewer.city,
          latitudeFuzzy: viewer.latitudeFuzzy,
          longitudeFuzzy: viewer.longitudeFuzzy,
        }
      : null,
    revealAge: !hideAge,
    revealDistance: !hideDistance,
    sign,
    includeUnapprovedPhotos: viewer?.id === profile.id,
  });
  assertPublicProfileHasNoSecrets(payload, 'public');
  return payload;
}

const presigns = new Map<string, number[]>();

export function resetDatingPresignBudget(): void {
  presigns.clear();
}

export function assertHourlyPresignBudget(
  key: string,
  limit: number,
  now = Date.now(),
): void {
  const windowStart = now - 60 * 60 * 1000;
  const stamps = (presigns.get(key) ?? []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= limit) {
    throw new ValidationError('Too many upload requests. Try again later.');
  }
  stamps.push(now);
  presigns.set(key, stamps);
}

export class DatingProfileService {
  static async getMine(userId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    return presentOwnProfile(profile);
  }

  static async onboard(userId: string, input: DatingOnboardingInput) {
    const existing = await DatingProfileRepository.findByUserId(userId);
    if (existing)
      throw new ConflictError('A dating profile already exists for this account');
    const write = buildProfileWrite(userId, input);
    try {
      const created = await DatingProfileRepository.create(write);
      return presentOwnProfile(created);
    } catch (error) {
      rethrowDatingWrite(error, 'A dating profile already exists for this account');
    }
  }

  static async update(userId: string, input: Partial<DatingOnboardingInput>) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    if (profile.status === DatingProfileStatus.BANNED) {
      throw new ForbiddenError('Your 420 Dating profile is banned');
    }
    const merged: DatingOnboardingInput = {
      displayName: input.displayName ?? profile.displayName,
      birthDate: input.birthDate ?? profile.birthDate.toISOString().slice(0, 10),
      ageConfirmed: true,
      gender: input.gender ?? profile.gender,
      interestedIn: input.interestedIn ?? (profile.interestedIn as DatingGender[]),
      datingIntention: input.datingIntention ?? profile.datingIntention,
      consumptionHabits: input.consumptionHabits ?? profile.consumptionHabits,
      favoriteStrains: input.favoriteStrains ?? profile.favoriteStrains,
      cannabisExperienceLevel:
        input.cannabisExperienceLevel ?? profile.cannabisExperienceLevel,
      favoriteMethods: input.favoriteMethods ?? profile.favoriteMethods,
      lifestyleInterests: input.lifestyleInterests ?? profile.lifestyleInterests,
      bio: input.bio === undefined ? profile.bio : input.bio,
      city: input.city ?? profile.city,
      state: input.state ?? profile.state,
      country: input.country ?? profile.country,
      latitude: input.latitude,
      longitude: input.longitude,
      prompts: input.prompts ?? readPrompts(profile.profilePrompts),
      isIncognito: input.isIncognito ?? profile.isIncognito,
      isDistanceHidden: input.isDistanceHidden ?? profile.isDistanceHidden,
      isAgeHidden: input.isAgeHidden ?? profile.isAgeHidden,
    };
    const write = buildProfileWrite(userId, merged);
    const data: Prisma.DatingProfileUpdateInput = {
      displayName: write.displayName,
      birthDate: write.birthDate,
      gender: write.gender,
      interestedIn: write.interestedIn,
      bio: write.bio,
      datingIntention: write.datingIntention,
      consumptionHabits: write.consumptionHabits,
      favoriteStrains: write.favoriteStrains,
      cannabisExperienceLevel: write.cannabisExperienceLevel,
      favoriteMethods: write.favoriteMethods,
      lifestyleInterests: write.lifestyleInterests,
      city: write.city,
      state: write.state,
      country: write.country,
      profilePrompts: write.profilePrompts as unknown as Prisma.InputJsonValue,
      isIncognito: write.isIncognito,
      isDistanceHidden: write.isDistanceHidden,
      isAgeHidden: write.isAgeHidden,
    };
    if (input.latitude !== undefined && input.longitude !== undefined) {
      data.latitudeFuzzy = write.latitudeFuzzy;
      data.longitudeFuzzy = write.longitudeFuzzy;
    }
    const updated = await DatingProfileRepository.update(profile.id, data);
    return presentOwnProfile(updated);
  }

  static async setStatus(userId: string, status: 'ACTIVE' | 'PAUSED') {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    if (profile.status === DatingProfileStatus.BANNED) {
      throw new ForbiddenError('Your 420 Dating profile is banned');
    }
    if (status === 'ACTIVE') {
      assertLegalAge(profile.birthDate);
      if (profile.photos.length < 1) {
        throw new ValidationError('Add a photo before activating your dating profile');
      }
    }
    const updated = await DatingProfileRepository.updateStatus(
      profile.id,
      status as DatingProfileStatus,
    );
    return presentOwnProfile(updated);
  }

  static async remove(userId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    try {
      await DatingProfileRepository.deleteById(profile.id);
    } catch (error) {
      rethrowDatingWrite(error, 'Dating profile could not be deleted');
    }
    return { deleted: true };
  }

  static async getPublic(viewerUserId: string, profileId: string) {
    const viewer = await requireDatingProfile(viewerUserId);
    const profile = await DatingProfileRepository.findById(profileId);
    if (!profile || profile.status === DatingProfileStatus.BANNED) {
      throw new NotFoundError('Dating profile not found');
    }
    if (profile.id !== viewer.id && profile.status !== DatingProfileStatus.ACTIVE) {
      throw new NotFoundError('Dating profile not found');
    }
    return presentPublicProfile(profile, viewer);
  }

  static async presignVerification(
    userId: string,
    contentType: string,
    fileSizeBytes: number,
  ) {
    const profile = await requireDatingProfile(userId);
    assertDatingImageSize(fileSizeBytes);
    assertHourlyPresignBudget(`verify:${profile.id}`, 5);
    const objectKey = buildDatingVerificationPhotoKey({
      profileId: profile.id,
      contentType,
    });
    const signed = await getStorageService().createPresignedUpload({
      objectKey,
      contentType,
      contentLength: fileSizeBytes,
    });
    return signed;
  }

  static async confirmVerification(userId: string, objectKey: string) {
    const profile = await requireDatingProfile(userId);
    const parsed = parseDatingVerificationPhotoKey(objectKey);
    if (!parsed || parsed.profileId !== profile.id) {
      throw new ValidationError('Verification photo key does not belong to this profile');
    }
    const updated = await DatingProfileRepository.updateVerification(
      profile.id,
      DatingVerificationStatus.PENDING_SELFIE,
      objectKey,
    );
    return presentOwnProfile(updated);
  }

  static async reviewVerification(profileId: string, status: 'VERIFIED' | 'REJECTED') {
    const profile = await DatingProfileRepository.findById(profileId);
    if (!profile) throw new NotFoundError('Dating profile not found');
    const next =
      status === 'VERIFIED'
        ? DatingVerificationStatus.VERIFIED
        : DatingVerificationStatus.REJECTED;
    const updated = await DatingProfileRepository.updateVerification(profile.id, next);
    const type =
      status === 'VERIFIED'
        ? DatingNotificationType.VERIFICATION_APPROVED
        : DatingNotificationType.VERIFICATION_REJECTED;
    await DatingNotificationRepository.create({
      profileId: profile.id,
      type,
      title:
        status === 'VERIFIED'
          ? 'Dating profile verified'
          : 'Verification was not approved',
      body: null,
      relatedEntityId: profile.id,
    });
    return { id: updated.id, verificationStatus: updated.verificationStatus };
  }
}
