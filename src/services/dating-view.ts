import { Prisma } from '@prisma/client';
import { ageFromBirthDate, distanceMiles } from './dating-geo.js';

export interface DatingPrompt {
  promptId: string;
  question: string;
  answer: string;
}

export interface DatingPhotoView {
  id: string;
  url: string | null;
  sortOrder: number;
  isPrimary: string | boolean;
  caption: string | null;
}

export function readPrompts(value: Prisma.JsonValue | null | undefined): DatingPrompt[] {
  if (!Array.isArray(value)) return [];
  const prompts: DatingPrompt[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.promptId !== 'string' || typeof row.question !== 'string') continue;
    if (typeof row.answer !== 'string') continue;
    prompts.push({
      promptId: row.promptId,
      question: row.question,
      answer: row.answer,
    });
  }
  return prompts;
}

export function datingPage<T>(items: T[], total: number, page: number, limit: number) {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

type PhotoLike = {
  id: string;
  objectKey: string;
  sortOrder: number;
  isPrimary: boolean;
  caption: string | null;
  moderationStatus: string;
};

export async function presentPhotos(
  photos: PhotoLike[],
  sign: (objectKey: string) => Promise<string | null>,
  includeUnapproved: boolean,
) {
  const visible = includeUnapproved
    ? photos
    : photos.filter((photo) => photo.moderationStatus === 'APPROVED');
  return Promise.all(
    visible
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(async (photo) => ({
        id: photo.id,
        url: await sign(photo.objectKey),
        sortOrder: photo.sortOrder,
        isPrimary: photo.isPrimary,
        caption: photo.caption,
      })),
  );
}

export function primaryPhoto(photos: PhotoLike[]): PhotoLike | null {
  const approved = photos.filter((photo) => photo.moderationStatus === 'APPROVED');
  return (
    approved.find((photo) => photo.isPrimary) ??
    approved.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0] ??
    null
  );
}

type NarrativeSource = {
  id: string;
  displayName: string;
  birthDate: Date;
  gender: string;
  city: string;
  state: string;
  country: string;
  verificationStatus: string;
  datingIntention: string;
  consumptionHabits: string[];
  favoriteMethods: string[];
  cannabisExperienceLevel: string;
  favoriteStrains: string[];
  lifestyleInterests: string[];
  bio: string | null;
  profilePrompts: Prisma.JsonValue | null;
  isAgeHidden: boolean;
  isDistanceHidden: boolean;
  latitudeFuzzy: number | null;
  longitudeFuzzy: number | null;
  photos: PhotoLike[];
};

export async function presentNarrative(
  profile: NarrativeSource,
  options: {
    viewer: {
      city: string;
      latitudeFuzzy: number | null;
      longitudeFuzzy: number | null;
    } | null;
    revealAge: boolean;
    revealDistance: boolean;
    sign: (objectKey: string) => Promise<string | null>;
    includeUnapprovedPhotos: boolean;
  },
) {
  const age = options.revealAge ? ageFromBirthDate(profile.birthDate) : null;
  let distanceMilesValue: number | null = null;
  let distanceLabel: string | null = null;
  const viewer = options.viewer;
  if (
    viewer &&
    options.revealDistance &&
    viewer.latitudeFuzzy != null &&
    viewer.longitudeFuzzy != null &&
    profile.latitudeFuzzy != null &&
    profile.longitudeFuzzy != null
  ) {
    distanceMilesValue = distanceMiles(
      viewer.latitudeFuzzy,
      viewer.longitudeFuzzy,
      profile.latitudeFuzzy,
      profile.longitudeFuzzy,
    );
  } else if (viewer && !options.revealDistance) {
    distanceLabel =
      viewer.city.trim().toLowerCase() === profile.city.trim().toLowerCase()
        ? 'Same City'
        : 'Nearby';
  }

  return {
    id: profile.id,
    vitals: {
      displayName: profile.displayName,
      age,
      gender: profile.gender,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      distanceMiles: distanceMilesValue,
      distanceLabel,
      verificationStatus: profile.verificationStatus,
    },
    photos: await presentPhotos(
      profile.photos,
      options.sign,
      options.includeUnapprovedPhotos,
    ),
    prompts: readPrompts(profile.profilePrompts),
    cannabisVitals: {
      consumptionHabits: profile.consumptionHabits,
      favoriteMethods: profile.favoriteMethods,
      cannabisExperienceLevel: profile.cannabisExperienceLevel,
      favoriteStrains: profile.favoriteStrains,
    },
    lifestyle: {
      datingIntention: profile.datingIntention,
      lifestyleInterests: profile.lifestyleInterests,
      bio: profile.bio,
    },
  };
}

const SECRET_KEYS = new Set([
  'birthdate',
  'latitude',
  'longitude',
  'latitudefuzzy',
  'longitudefuzzy',
  'verificationphotokey',
  'voiceintroobjectkey',
  'email',
  'phone',
  'phonenumber',
  'passwordhash',
  'objectkey',
  'moderationstatus',
  'resolutionnotes',
  'reviewedbyid',
  'reviewedat',
  'accountstatus',
]);

const PUBLIC_ONLY_SECRET_KEYS = new Set(['userid', 'status', 'isincognito']);

function rejectSecret(value: unknown, scope: 'public' | 'owner'): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectSecret(item, scope);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('dating-verification/')) {
      throw new Error('Dating payload leaked a verification photo');
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const norm = key.toLowerCase();
    if (
      SECRET_KEYS.has(norm) ||
      (scope === 'public' && PUBLIC_ONLY_SECRET_KEYS.has(norm))
    ) {
      throw new Error(`Dating payload leaked ${key}`);
    }
    rejectSecret(child, scope);
  }
}

/** Public cards hide account, coordinate, verification, and moderation fields. Owner payloads may include userId and status. */
export function assertPublicProfileHasNoSecrets(
  payload: unknown,
  scope: 'public' | 'owner' = 'public',
): void {
  rejectSecret(payload, scope);
}
