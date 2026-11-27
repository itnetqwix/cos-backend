import {
  CannabisExperienceLevel,
  DatingGender,
  DatingIntention,
  DatingProfileStatus,
  DatingVerificationStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/database.js';
import { DatingPrompt } from '../services/dating-view.js';

const profileInclude = {
  photos: { orderBy: { sortOrder: 'asc' as const } },
  preferences: true,
} satisfies Prisma.DatingProfileInclude;

export type DatingProfileRecord = Prisma.DatingProfileGetPayload<{
  include: typeof profileInclude;
}>;

export type DatingPreferencesWrite = {
  minAge: number;
  maxAge: number;
  ageDealbreaker: boolean;
  maxDistanceMiles: number;
  distanceDealbreaker: boolean;
  targetGenders: string[];
  genderDealbreaker: boolean;
  cannabisHabitsFilter: string[];
  cannabisHabitsDealbreaker: boolean;
  intentionsFilter: string[];
  intentionsDealbreaker: boolean;
  verifiedOnly: boolean;
};

export type DatingProfileWrite = {
  userId: string;
  displayName: string;
  birthDate: Date | null;
  statedAge: number | null;
  gender: DatingGender;
  interestedIn: string[];
  bio: string | null;
  datingIntention: DatingIntention;
  consumptionHabits: string[];
  favoriteStrains: string[];
  cannabisExperienceLevel: CannabisExperienceLevel;
  favoriteMethods: string[];
  lifestyleInterests: string[];
  city: string;
  state: string;
  country: string;
  latitudeFuzzy: number | null;
  longitudeFuzzy: number | null;
  profilePrompts: DatingPrompt[];
  isIncognito: boolean;
  isDistanceHidden: boolean;
  isAgeHidden: boolean;
  preferences: DatingPreferencesWrite;
};

const preferenceFields = [
  'minAge',
  'maxAge',
  'ageDealbreaker',
  'maxDistanceMiles',
  'distanceDealbreaker',
  'targetGenders',
  'genderDealbreaker',
  'cannabisHabitsFilter',
  'cannabisHabitsDealbreaker',
  'intentionsFilter',
  'intentionsDealbreaker',
  'verifiedOnly',
] as const;

export class DatingProfileRepository {
  static async findByUserId(userId: string): Promise<DatingProfileRecord | null> {
    return prisma.datingProfile.findUnique({
      where: { userId },
      include: profileInclude,
    });
  }

  static async findById(id: string): Promise<DatingProfileRecord | null> {
    return prisma.datingProfile.findUnique({
      where: { id },
      include: profileInclude,
    });
  }

  static async create(data: DatingProfileWrite): Promise<DatingProfileRecord> {
    return prisma.datingProfile.create({
      data: {
        userId: data.userId,
        displayName: data.displayName,
        birthDate: data.birthDate,
        statedAge: data.statedAge,
        gender: data.gender,
        interestedIn: data.interestedIn,
        bio: data.bio,
        datingIntention: data.datingIntention,
        consumptionHabits: data.consumptionHabits,
        favoriteStrains: data.favoriteStrains,
        cannabisExperienceLevel: data.cannabisExperienceLevel,
        favoriteMethods: data.favoriteMethods,
        lifestyleInterests: data.lifestyleInterests,
        city: data.city,
        state: data.state,
        country: data.country,
        latitudeFuzzy: data.latitudeFuzzy,
        longitudeFuzzy: data.longitudeFuzzy,
        profilePrompts: data.profilePrompts as unknown as Prisma.InputJsonValue,
        isIncognito: data.isIncognito,
        isDistanceHidden: data.isDistanceHidden,
        isAgeHidden: data.isAgeHidden,
        preferences: { create: data.preferences },
      },
      include: profileInclude,
    });
  }

  static async update(
    id: string,
    data: Prisma.DatingProfileUpdateInput,
  ): Promise<DatingProfileRecord> {
    return prisma.datingProfile.update({
      where: { id },
      data,
      include: profileInclude,
    });
  }

  static async updatePreferences(
    profileId: string,
    data: Partial<DatingPreferencesWrite>,
  ): Promise<DatingProfileRecord> {
    const preferences: Prisma.DatingPreferencesUpdateInput = {};
    for (const field of preferenceFields) {
      if (data[field] !== undefined) {
        (preferences as Record<string, unknown>)[field] = data[field];
      }
    }
    return prisma.datingProfile.update({
      where: { id: profileId },
      data: { preferences: { update: preferences } },
      include: profileInclude,
    });
  }

  static async deleteById(id: string): Promise<void> {
    await prisma.datingProfile.delete({ where: { id } });
  }

  static async updateStatus(
    id: string,
    status: DatingProfileStatus,
  ): Promise<DatingProfileRecord> {
    return prisma.datingProfile.update({
      where: { id },
      data: { status },
      include: profileInclude,
    });
  }

  static async updateVerification(
    id: string,
    verificationStatus: DatingVerificationStatus,
    verificationPhotoKey?: string | null,
  ): Promise<DatingProfileRecord> {
    return prisma.datingProfile.update({
      where: { id },
      data: {
        verificationStatus,
        ...(verificationPhotoKey !== undefined ? { verificationPhotoKey } : {}),
      },
      include: profileInclude,
    });
  }
}
