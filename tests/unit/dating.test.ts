import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatingGender, DatingProfileStatus, LikeTargetType, Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { DatingProfileRepository } from '../../src/repositories/dating-profile.repository.js';
import { DatingPhotoRepository } from '../../src/repositories/dating-photo.repository.js';
import { DatingLikeRepository } from '../../src/repositories/dating-like.repository.js';
import { DatingMatchRepository } from '../../src/repositories/dating-match.repository.js';
import { DatingChatRepository } from '../../src/repositories/dating-chat.repository.js';
import {
  DatingSafetyRepository,
  DatingNotificationRepository,
} from '../../src/repositories/dating-safety.repository.js';
import { DatingChatController } from '../../src/controllers/dating-chat.controller.js';
import {
  buildDiscoverWhere,
  passesDistanceDealbreaker,
} from '../../src/services/dating-discovery.service.js';
import { DatingMatchService } from '../../src/services/dating-match.service.js';
import { DatingPhotoService } from '../../src/services/dating-photo.service.js';
import {
  DatingProfileService,
  buildProfileWrite,
  resetDatingPresignBudget,
} from '../../src/services/dating-profile.service.js';
import { DatingChatService } from '../../src/services/dating-chat.service.js';
import { DatingSafetyService } from '../../src/services/dating-safety.service.js';
import { findProhibitedTerm } from '../../src/services/dating-policy.js';
import { fuzzCoordinates } from '../../src/services/dating-geo.js';
import {
  datingSubscriberCount,
  publishDating,
  resetDatingListeners,
  subscribeDating,
} from '../../src/services/dating-realtime.js';
import { assertDatingProtectionsIntact } from '../../src/services/dating-sql-guard.js';
import {
  discoverCandidateQuery,
  sqlText,
} from '../../src/repositories/dating-discovery.query.js';
import {
  assertPublicProfileHasNoSecrets,
} from '../../src/services/dating-view.js';
import {
  presentOwnProfile,
  presentPublicProfile,
} from '../../src/services/dating-profile.service.js';
import {
  buildDatingPhotoObjectKey,
  getStorageService,
  setStorageService,
  type StorageService,
} from '../../src/services/storage.service.js';
import { ForbiddenError, ValidationError } from '../../src/utils/response.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE,
    userId: USER,
    displayName: 'Ada',
    birthDate: new Date('1990-05-02T00:00:00.000Z'),
    gender: DatingGender.WOMAN,
    interestedIn: [DatingGender.MAN],
    bio: 'Ceramics and long walks',
    datingIntention: 'LONG_TERM',
    consumptionHabits: ['Weekends'],
    favoriteStrains: ['Gelato'],
    cannabisExperienceLevel: 'CASUAL_PUFFER',
    favoriteMethods: ['Joint'],
    lifestyleInterests: ['Hiking'],
    city: 'Boulder',
    state: 'CO',
    country: 'USA',
    latitudeFuzzy: 40.01,
    longitudeFuzzy: -105.27,
    voiceIntroObjectKey: null,
    voiceIntroDurationSeconds: null,
    vibeAnswers: null,
    profilePrompts: [
      {
        promptId: 'ideal-420-date',
        question: 'Our ideal 4/20 date would be...',
        answer: 'Stargazing',
      },
    ],
    verificationStatus: 'UNVERIFIED',
    verificationPhotoKey: null,
    status: DatingProfileStatus.ACTIVE,
    isIncognito: false,
    isDistanceHidden: false,
    isAgeHidden: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    photos: [],
    preferences: {
      id: 'pref',
      profileId: PROFILE,
      minAge: 21,
      maxAge: 35,
      ageDealbreaker: true,
      maxDistanceMiles: 30,
      distanceDealbreaker: false,
      targetGenders: [DatingGender.MAN],
      genderDealbreaker: true,
      cannabisHabitsFilter: ['Daily'],
      cannabisHabitsDealbreaker: false,
      intentionsFilter: [],
      intentionsDealbreaker: false,
      verifiedOnly: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  };
}

describe('420 dating backend', { concurrency: false }, () => {
  const originals = {
    findByUserId: DatingProfileRepository.findByUserId,
    findById: DatingProfileRepository.findById,
    createProfile: DatingProfileRepository.create,
    updateStatus: DatingProfileRepository.updateStatus,
    photoFind: DatingPhotoRepository.findById,
    photoKey: DatingPhotoRepository.findByObjectKey,
    photoCount: DatingPhotoRepository.count,
    photoList: DatingPhotoRepository.listByProfile,
    photoCreate: DatingPhotoRepository.create,
    likePair: DatingLikeRepository.findPair,
    likeCreate: DatingLikeRepository.create,
    likeUpdate: DatingLikeRepository.update,
    likeCount: DatingLikeRepository.countSince,
    matchPair: DatingMatchRepository.findByPair,
    matchCreate: DatingMatchRepository.createWithConversation,
    matchDeactivate: DatingMatchRepository.deactivatePair,
    chatFind: DatingChatRepository.findById,
    chatByMatch: DatingChatRepository.findByMatchId,
    chatLatest: DatingChatRepository.latestOtherMessage,
    chatCount: DatingChatRepository.countSince,
    chatCreate: DatingChatRepository.createMessage,
    blocked: DatingSafetyRepository.isEitherBlocked,
    blockCreate: DatingSafetyRepository.createBlock,
    blockFind: DatingSafetyRepository.findBlock,
    notify: DatingNotificationRepository.create,
    account: UserRepository.findAccountGate,
  };
  let previousStorage: StorageService | null = null;
  let app: FastifyInstance | null = null;

  before(() => {
    try {
      previousStorage = getStorageService();
    } catch {
      previousStorage = null;
    }
  });

  after(async () => {
    DatingProfileRepository.findByUserId = originals.findByUserId;
    DatingProfileRepository.findById = originals.findById;
    DatingProfileRepository.create = originals.createProfile;
    DatingProfileRepository.updateStatus = originals.updateStatus;
    DatingPhotoRepository.findById = originals.photoFind;
    DatingPhotoRepository.findByObjectKey = originals.photoKey;
    DatingPhotoRepository.count = originals.photoCount;
    DatingPhotoRepository.listByProfile = originals.photoList;
    DatingPhotoRepository.create = originals.photoCreate;
    DatingLikeRepository.findPair = originals.likePair;
    DatingLikeRepository.create = originals.likeCreate;
    DatingLikeRepository.update = originals.likeUpdate;
    DatingLikeRepository.countSince = originals.likeCount;
    DatingMatchRepository.findByPair = originals.matchPair;
    DatingMatchRepository.createWithConversation = originals.matchCreate;
    DatingMatchRepository.deactivatePair = originals.matchDeactivate;
    DatingChatRepository.findById = originals.chatFind;
    DatingChatRepository.findByMatchId = originals.chatByMatch;
    DatingChatRepository.latestOtherMessage = originals.chatLatest;
    DatingChatRepository.countSince = originals.chatCount;
    DatingChatRepository.createMessage = originals.chatCreate;
    DatingSafetyRepository.isEitherBlocked = originals.blocked;
    DatingSafetyRepository.createBlock = originals.blockCreate;
    DatingSafetyRepository.findBlock = originals.blockFind;
    DatingNotificationRepository.create = originals.notify;
    UserRepository.findAccountGate = originals.account;
    setStorageService(previousStorage);
    resetDatingListeners();
    resetDatingPresignBudget();
    if (app) await app.close();
  });

  it('adds dating tables and database checks without rewriting contest tables', () => {
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const sql = readFileSync(
      path.join(
        ROOT,
        'prisma/migrations/20261120120000_add_420_dating_module/migration.sql',
      ),
      'utf8',
    );
    assert.match(schema, /model DatingProfile/);
    assert.match(schema, /model DatingNotification/);
    assert.match(sql, /CREATE TABLE "dating_profiles"/);
    assert.match(sql, /chk_dating_match_canonical_order/);
    assert.match(sql, /chk_dating_like_no_self/);
    assert.match(sql, /chk_dating_min_age_18/);
    assert.match(sql, /trg_check_dating_photo_limit/);
    assert.doesNotThrow(() => assertDatingProtectionsIntact());
    assert.doesNotMatch(sql, /ALTER TABLE "contests"/);
    assert.doesNotMatch(sql, /ALTER TABLE "submissions"/);
  });

  it('rejects under-18 onboarding and stores only fuzzy coordinates for adults', async () => {
    let created: unknown = null;
    DatingProfileRepository.findByUserId = async () => null;
    DatingProfileRepository.create = async (data) => {
      created = data;
      return profile({
        birthDate: data.birthDate,
        latitudeFuzzy: data.latitudeFuzzy,
        longitudeFuzzy: data.longitudeFuzzy,
        displayName: data.displayName,
      }) as never;
    };
    await assert.rejects(
      () =>
        DatingProfileService.onboard(USER, {
          displayName: 'Teen',
          birthDate: '2012-01-01',
          ageConfirmed: true,
          gender: DatingGender.WOMAN,
          interestedIn: [DatingGender.MAN],
          city: 'Boulder',
          state: 'CO',
        }),
      (error: unknown) => error instanceof ValidationError && /18/.test(error.message),
    );
    assert.equal(created, null);

    const view = await DatingProfileService.onboard(USER, {
      displayName: 'Ada',
      birthDate: '1990-05-02',
      ageConfirmed: true,
      gender: DatingGender.WOMAN,
      interestedIn: [DatingGender.MAN],
      city: 'Boulder',
      state: 'CO',
      latitude: 40,
      longitude: -105,
    });
    const write = created as { latitudeFuzzy: number; longitudeFuzzy: number };
    assert.notEqual(write.latitudeFuzzy, 40);
    assert.notEqual(write.longitudeFuzzy, -105);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes('birthDate'), false);
    assert.equal(serialized.includes('latitudeFuzzy'), false);
    assert.equal(serialized.includes('"age"'), true);
  });

  it('moves coordinates by 1 to 2.5 miles and rejects sale language', () => {
    const point = fuzzCoordinates(40, -105, () => 0);
    assert.notEqual(point.latitudeFuzzy, 40);
    assert.equal(findProhibitedTerm('cashapp me for a zip'), 'cashapp');
    assert.equal(findProhibitedTerm('I like long hikes'), null);
  });

  it('rejects a photo key owned by another profile and confirms an owned upload', async () => {
    setStorageService({
      async createPresignedUpload(request) {
        return {
          uploadUrl: 'https://example.test/upload',
          objectKey: request.objectKey,
          headers: { 'Content-Type': request.contentType },
          expiresInSeconds: 900,
          method: 'PUT',
        };
      },
      async createPresignedDownload(objectKey) {
        return `https://example.test/${objectKey}`;
      },
    });
    DatingProfileRepository.findByUserId = async () => profile() as never;
    const foreign = buildDatingPhotoObjectKey({
      profileId: OTHER,
      contentType: 'image/jpeg',
      objectId: PHOTO,
    });
    await assert.rejects(
      () =>
        DatingPhotoService.confirm(USER, {
          objectKey: foreign,
          byteSize: 1000,
          contentType: 'image/jpeg',
        }),
      /does not belong/,
    );
    const owned = buildDatingPhotoObjectKey({
      profileId: PROFILE,
      contentType: 'image/png',
      objectId: PHOTO,
    });
    DatingPhotoRepository.findByObjectKey = async () => null;
    DatingPhotoRepository.count = async () => 0;
    DatingPhotoRepository.listByProfile = async () => [];
    DatingPhotoRepository.create = async (data) =>
      ({
        id: PHOTO,
        profileId: data.profileId,
        objectKey: data.objectKey,
        sortOrder: data.sortOrder,
        isPrimary: data.isPrimary,
        caption: data.caption,
        moderationStatus: 'APPROVED',
      }) as never;
    const saved = await DatingPhotoService.confirm(USER, {
      objectKey: owned,
      byteSize: 1000,
      contentType: 'image/png',
      caption: 'Red Rocks',
    });
    assert.equal(saved.isPrimary, true);
    assert.equal(saved.mediaType, 'image');
    assert.match(String(saved.url), /dating-photos/);
  });

  it('stores a stated age and does not invent a birth date', async () => {
    let created: { birthDate: Date | null; statedAge: number | null } | null = null;
    DatingProfileRepository.findByUserId = async () => null;
    DatingProfileRepository.create = async (data) => {
      created = { birthDate: data.birthDate, statedAge: data.statedAge };
      return profile({
        birthDate: data.birthDate,
        statedAge: data.statedAge,
        displayName: data.displayName,
      }) as never;
    };
    await assert.rejects(
      () =>
        DatingProfileService.onboard(USER, {
          displayName: 'Teen',
          age: 17,
          ageConfirmed: true,
          gender: DatingGender.WOMAN,
          interestedIn: [DatingGender.MAN],
          city: 'Boulder',
          state: 'CO',
        }),
      /18/,
    );
    assert.equal(created, null);
    const view = await DatingProfileService.onboard(USER, {
      displayName: 'Ada',
      age: 18,
      ageConfirmed: true,
      gender: DatingGender.WOMAN,
      interestedIn: [DatingGender.MAN],
      city: 'Boulder',
      state: 'CO',
    });
    assert.equal(created?.birthDate, null);
    assert.equal(created?.statedAge, 18);
    assert.equal(view.vitals.age, 18);
    assert.equal(JSON.stringify(view).includes('statedAge'), false);
  });

  it('keeps the first image as the profile photo when videos are uploaded', async () => {
    setStorageService({
      async createPresignedUpload(request) {
        return {
          uploadUrl: 'https://example.test/upload',
          objectKey: request.objectKey,
          headers: { 'Content-Type': request.contentType },
          expiresInSeconds: 900,
          method: 'PUT',
        };
      },
      async createPresignedDownload(objectKey) {
        return `https://example.test/${objectKey}`;
      },
    });
    DatingProfileRepository.findByUserId = async () => profile() as never;
    const rows: {
      id: string;
      objectKey: string;
      isPrimary: boolean;
      sortOrder: number;
      caption: string | null;
      moderationStatus: 'APPROVED';
      profileId: string;
    }[] = [];
    DatingPhotoRepository.findByObjectKey = async () => null;
    DatingPhotoRepository.listByProfile = async () => rows as never;
    DatingPhotoRepository.create = async (data) => {
      const row = {
        id: data.objectKey,
        profileId: data.profileId,
        objectKey: data.objectKey,
        sortOrder: data.sortOrder,
        isPrimary: data.isPrimary,
        caption: data.caption,
        moderationStatus: 'APPROVED' as const,
      };
      rows.push(row);
      return row as never;
    };
    const videoKey = buildDatingPhotoObjectKey({
      profileId: PROFILE,
      contentType: 'video/mp4',
      objectId: PHOTO,
    });
    const video = await DatingPhotoService.confirm(USER, {
      objectKey: videoKey,
      byteSize: 1000,
      contentType: 'video/mp4',
      durationSeconds: 12,
    });
    assert.equal(video.isPrimary, false);
    assert.equal(video.mediaType, 'video');
    const imageKey = buildDatingPhotoObjectKey({
      profileId: PROFILE,
      contentType: 'image/jpeg',
      objectId: '44444444-4444-4444-8444-444444444444',
    });
    const image = await DatingPhotoService.confirm(USER, {
      objectKey: imageKey,
      byteSize: 1000,
      contentType: 'image/jpeg',
    });
    assert.equal(image.isPrimary, true);
    const secondKey = buildDatingPhotoObjectKey({
      profileId: PROFILE,
      contentType: 'image/png',
      objectId: '55555555-5555-4555-8555-555555555555',
    });
    const second = await DatingPhotoService.confirm(USER, {
      objectKey: secondKey,
      byteSize: 1000,
      contentType: 'image/png',
    });
    assert.equal(second.isPrimary, false);
  });

  it('validates photo and prompt likes, creates one match, and does not duplicate it', async () => {
    const me = profile();
    const them = profile({
      id: OTHER,
      userId: OTHER_USER,
      displayName: 'Bea',
      gender: DatingGender.MAN,
      profilePrompts: [
        { promptId: 'ideal-420-date', question: 'Date?', answer: 'Stars' },
      ],
    });
    DatingProfileRepository.findByUserId = async (userId) =>
      (userId === USER ? me : them) as never;
    DatingProfileRepository.findById = async (id) => (id === OTHER ? them : me) as never;
    DatingSafetyRepository.isEitherBlocked = async () => false;
    DatingLikeRepository.countSince = async () => 0;
    DatingNotificationRepository.create = async (data) =>
      ({ id: 'note', ...data }) as never;
    DatingPhotoRepository.findById = async (id) =>
      id === PHOTO
        ? ({ id: PHOTO, profileId: OTHER, objectKey: 'dating-photos/x.jpg' } as never)
        : null;
    const likes = new Map<
      string,
      { isPass: boolean; id: string; comment: string | null }
    >();
    DatingLikeRepository.findPair = async (sender, receiver) => {
      const row = likes.get(`${sender}:${receiver}`);
      return row
        ? ({ ...row, senderProfileId: sender, receiverProfileId: receiver } as never)
        : null;
    };
    DatingLikeRepository.create = async (data) => {
      const row = {
        id: `like-${likes.size + 1}`,
        isPass: data.isPass,
        comment: data.comment,
      };
      likes.set(`${data.senderProfileId}:${data.receiverProfileId}`, row);
      return { ...data, ...row, createdAt: new Date() } as never;
    };
    let matches = 0;
    DatingMatchRepository.findByPair = async () => null;
    DatingMatchRepository.createWithConversation = async (data) => {
      matches += 1;
      return {
        id: 'match-1',
        profileLowId: data.profileLowId,
        profileHighId: data.profileHighId,
        isActive: true,
        matchedAt: new Date('2026-11-20T00:00:00.000Z'),
        profileLow: data.profileLowId === me.id ? me : them,
        profileHigh: data.profileHighId === me.id ? me : them,
        conversation: { id: 'conv-1' },
        originatingLike: null,
      } as never;
    };
    DatingChatRepository.findByMatchId = async () =>
      ({ id: 'conv-1', matchId: 'match-1' }) as never;
    DatingChatRepository.latestOtherMessage = async () =>
      ({
        id: 'msg-1',
        body: 'Stars sound perfect',
        createdAt: new Date('2026-11-20T00:00:00.000Z'),
      }) as never;

    await assert.rejects(
      () =>
        DatingMatchService.like(USER, {
          receiverProfileId: OTHER,
          targetType: LikeTargetType.PHOTO,
          targetId: '99999999-9999-4999-8999-999999999999',
        }),
      /does not belong/,
    );
    await assert.rejects(
      () =>
        DatingMatchService.like(USER, {
          receiverProfileId: OTHER,
          targetType: LikeTargetType.PROMPT,
          targetId: 'missing-prompt',
        }),
      /prompt does not belong/,
    );
    const pending = await DatingMatchService.like(USER, {
      receiverProfileId: OTHER,
      targetType: LikeTargetType.PROMPT,
      targetId: 'ideal-420-date',
      comment: 'Stars sound perfect',
    });
    assert.equal(pending.isMatch, false);
    assert.equal(matches, 0);

    DatingProfileRepository.findByUserId = async (userId) =>
      (userId === OTHER_USER ? them : me) as never;
    const matched = await DatingMatchService.like(OTHER_USER, {
      receiverProfileId: PROFILE,
      targetType: LikeTargetType.PROFILE,
      comment: 'Same',
    });
    assert.equal(matched.isMatch, true);
    assert.equal(matches, 1);
    assert.equal(matched.match?.conversationId, 'conv-1');

    DatingMatchRepository.findByPair = async () =>
      ({
        id: 'match-1',
        isActive: true,
        profileLowId: PROFILE < OTHER ? PROFILE : OTHER,
        profileHighId: PROFILE < OTHER ? OTHER : PROFILE,
        matchedAt: new Date(),
        profileLow: me,
        profileHigh: them,
        conversation: { id: 'conv-1' },
      }) as never;
    likes.delete(`${OTHER}:${PROFILE}`);
    const again = await DatingMatchService.like(OTHER_USER, {
      receiverProfileId: PROFILE,
      targetType: LikeTargetType.PROFILE,
    });
    assert.equal(again.isMatch, true);
    assert.equal(matches, 1);
  });

  it('builds dealbreaker filters and drops profiles outside the distance', () => {
    const viewer = profile() as never;
    const where = buildDiscoverWhere({
      viewer,
      now: new Date('2026-11-20T00:00:00.000Z'),
    });
    assert.equal(where.status, 'ACTIVE');
    const serialized = JSON.stringify(where);
    assert.match(serialized, /birthDate/);
    assert.match(serialized, /MAN/);
    assert.match(serialized, /likesReceived/);
    assert.match(serialized, /blocksInitiated/);
    const ranked = discoverCandidateQuery({
      viewer: profile({
        preferences: { ...profile().preferences, distanceDealbreaker: true },
      }) as never,
      skip: 0,
      take: 10,
      now: new Date('2026-11-20T00:00:00.000Z'),
    });
    const rankedSql = sqlText(ranked.list);
    assert.match(rankedSql, /NOT EXISTS/);
    assert.match(rankedSql, /dating_likes/);
    assert.match(rankedSql, /dating_matches/);
    assert.match(rankedSql, /dating_blocks/);
    assert.match(rankedSql, /3958.8/);
    assert.match(rankedSql, /ORDER BY/);
    assert.doesNotMatch(sqlText(discoverCandidateQuery({
      viewer,
      skip: 0,
      take: 10,
    }).list), /3958.8/);
    const far = profile({
      id: OTHER,
      latitudeFuzzy: 10,
      longitudeFuzzy: 10,
    }) as never;
    const near = profile({
      id: OTHER,
      latitudeFuzzy: 40.02,
      longitudeFuzzy: -105.2,
    }) as never;
    const strict = profile({
      preferences: { ...profile().preferences, distanceDealbreaker: true },
    }) as never;
    assert.equal(passesDistanceDealbreaker(strict, far), false);
    assert.equal(passesDistanceDealbreaker(strict, near), true);
    assert.equal(passesDistanceDealbreaker(viewer, far), true);
  });

  it('hides private fields on public and owner dating profiles', async () => {
    assert.throws(
      () =>
        assertPublicProfileHasNoSecrets({
          vitals: { birthDate: '1990-01-01', latitudeFuzzy: 1, longitudeFuzzy: 2 },
          verificationPhotoKey: 'dating-verification/a/b.jpg',
          email: 'a@b.c',
          objectKey: 'dating-photos/a/b.jpg',
          moderationStatus: 'PENDING',
        }),
      /leaked/,
    );
    assert.throws(() => assertPublicProfileHasNoSecrets({ userId: USER }), /userId/);
    assert.doesNotThrow(() =>
      assertPublicProfileHasNoSecrets({ userId: USER, status: 'ACTIVE' }, 'owner'),
    );
    const row = profile({
      photos: [
        {
          id: PHOTO,
          objectKey: 'dating-photos/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.jpg',
          sortOrder: 0,
          isPrimary: true,
          caption: null,
          moderationStatus: 'APPROVED',
          createdAt: new Date(),
          updatedAt: new Date(),
          profileId: PROFILE,
        },
      ],
    }) as never;
    const previous = getStorageService();
    setStorageService({
      createPresignedUpload: async () => {
        throw new Error('unused');
      },
      createPresignedDownload: async () => 'https://example.test/photo',
    } as never);
    try {
      assertPublicProfileHasNoSecrets(await presentPublicProfile(row, row));
      assertPublicProfileHasNoSecrets(await presentOwnProfile(row), 'owner');
    } finally {
      setStorageService(previous);
    }
  });

  it('closes a match when a profile is blocked and refuses messages from outsiders', async () => {
    DatingProfileRepository.findByUserId = async () => profile() as never;
    DatingProfileRepository.findById = async () =>
      profile({ id: OTHER, userId: OTHER_USER }) as never;
    DatingSafetyRepository.findBlock = async () => null;
    let deactivated = false;
    DatingSafetyRepository.createBlock = async () =>
      ({ id: 'block-1', createdAt: new Date('2026-11-20T00:00:00.000Z') }) as never;
    DatingMatchRepository.deactivatePair = async () => {
      deactivated = true;
      return { isActive: false } as never;
    };
    const block = await DatingSafetyService.block(USER, OTHER);
    assert.equal(block.id, 'block-1');
    assert.equal(deactivated, true);

    DatingChatRepository.findById = async () =>
      ({
        id: 'conv-1',
        match: { profileLowId: PROFILE, profileHighId: OTHER, isActive: false },
      }) as never;
    DatingSafetyRepository.isEitherBlocked = async () => false;
    await assert.rejects(
      () => DatingChatService.send(USER, 'conv-1', { body: 'hello' }),
      (error: unknown) => error instanceof ForbiddenError,
    );
  });

  it('rejects a message from a profile that is not in the conversation', async () => {
    DatingProfileRepository.findByUserId = async () =>
      profile({ id: '44444444-4444-4444-8444-444444444444' }) as never;
    DatingChatRepository.findById = async () =>
      ({
        id: 'conv-1',
        match: { profileLowId: PROFILE, profileHighId: OTHER, isActive: true },
      }) as never;
    await assert.rejects(
      () => DatingChatService.messages(USER, 'conv-1', 1, 20),
      /not found/i,
    );
  });

  it('delivers dating events to every subscriber and drops them after unsubscribe', () => {
    resetDatingListeners();
    const first: string[] = [];
    const second: string[] = [];
    const stopFirst = subscribeDating(USER, (event) => first.push(event.type));
    subscribeDating(USER, (event) => second.push(event.type));
    subscribeDating(OTHER_USER, (event) => second.push(event.type));
    publishDating([USER, OTHER_USER], {
      type: 'match',
      match: { id: 'match-1' },
    });
    stopFirst();
    assert.equal(datingSubscriberCount(USER), 1);
    publishDating([USER], {
      type: 'like_received',
      likeId: 'l',
      senderProfileId: OTHER,
      receiverProfileId: PROFILE,
    });
    assert.deepEqual(first, ['match']);
    assert.deepEqual(second, ['match', 'match', 'like_received']);
  });

  it('writes an SSE retry hint and a match event for the authenticated user', async () => {
    resetDatingListeners();
    const request = new EventEmitter() as EventEmitter & {
      user: { id: string };
      raw: EventEmitter;
    };
    request.user = { id: USER };
    request.raw = new EventEmitter();
    const chunks: string[] = [];
    const raw = new EventEmitter() as EventEmitter & {
      headersSent: boolean;
      writableEnded: boolean;
      destroyed: boolean;
      writeHead: () => void;
      write: (chunk: string) => boolean;
    };
    raw.headersSent = false;
    raw.writableEnded = false;
    raw.destroyed = false;
    raw.writeHead = () => {
      raw.headersSent = true;
    };
    raw.write = (chunk: string) => {
      chunks.push(chunk);
      return true;
    };
    const reply = { sent: false, hijack() {}, raw };
    const pending = DatingChatController.stream(request as never, reply as never);
    publishDating([USER], {
      type: 'read',
      conversationId: 'conv-1',
      userId: OTHER_USER,
      profileId: OTHER,
      lastReadAt: '2026-11-20T00:00:00.000Z',
    });
    request.raw.emit('close');
    await pending;
    assert.match(chunks.join(''), /retry: 3000/);
    assert.match(chunks.join(''), /event: read/);
    assert.equal(datingSubscriberCount(USER), 0);
  });

  it('allows admins to ban and rejects creators on the moderation route', async () => {
    UserRepository.findAccountGate = async () =>
      ({ id: USER, role: Role.CREATOR, accountStatus: 'ACTIVE' }) as never;
    app = await buildApp();
    const creator = app.jwt.sign({
      id: USER,
      email: 'creator@ripskis.test',
      role: Role.CREATOR,
    });
    const admin = app.jwt.sign({
      id: ADMIN,
      email: 'admin@ripskis.test',
      role: Role.ADMIN,
    });
    const banned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/dating/profiles/${PROFILE}/ban`,
      headers: { authorization: `Bearer ${creator}` },
    });
    assert.equal(banned.statusCode, 403);
    assert.equal(banned.json().success, false);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/dating/profile/me' });
    assert.equal(missing.statusCode, 401);

    let bannedId = '';
    DatingProfileRepository.findById = async () => profile() as never;
    DatingProfileRepository.updateStatus = async (_id, status) => {
      bannedId = status;
      return profile({ status }) as never;
    };
    const allowed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/dating/profiles/${PROFILE}/ban`,
      headers: { authorization: `Bearer ${admin}` },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().success, true);
    assert.equal(bannedId, 'BANNED');
    assert.equal(JSON.stringify(allowed.json()).includes('birthDate'), false);
  });
});
