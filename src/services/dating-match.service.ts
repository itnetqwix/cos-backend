import { DatingProfileStatus, LikeTargetType } from '@prisma/client';
import { DatingLikeRepository } from '../repositories/dating-like.repository.js';
import { DatingMatchRepository } from '../repositories/dating-match.repository.js';
import { DatingChatRepository } from '../repositories/dating-chat.repository.js';
import { DatingProfileRepository } from '../repositories/dating-profile.repository.js';
import {
  DatingSafetyRepository,
  DatingNotificationRepository,
} from '../repositories/dating-safety.repository.js';
import { DatingPhotoRepository } from '../repositories/dating-photo.repository.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';
import { requireDatingProfile } from './dating-access.js';
import { DATING_COMMENT_MAX, DATING_LIKE_LIMIT_PER_DAY } from './dating-constants.js';
import { assertDatingTextAllowed } from './dating-policy.js';
import { readPrompts, datingPage, primaryPhoto } from './dating-view.js';
import { presentPublicProfile } from './dating-profile.service.js';
import { signedDatingPhotoUrl } from './storage.service.js';
import { publishDating } from './dating-realtime.js';
import { DatingNotificationType } from '@prisma/client';

export function canonicalProfilePair(a: string, b: string) {
  if (a === b) throw new ValidationError('You cannot like your own dating profile');
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right
    ? { profileLowId: a, profileHighId: b }
    : { profileLowId: b, profileHighId: a };
}

async function assertTarget(input: {
  receiverProfileId: string;
  targetType: LikeTargetType;
  targetId?: string | null;
}) {
  if (input.targetType === LikeTargetType.PROFILE) return input.targetId ?? null;
  if (!input.targetId)
    throw new ValidationError('targetId is required for photo and prompt likes');
  if (input.targetType === LikeTargetType.PHOTO) {
    const photo = await DatingPhotoRepository.findById(input.targetId);
    if (!photo || photo.profileId !== input.receiverProfileId) {
      throw new ValidationError('That photo does not belong to the selected profile');
    }
    return photo.id;
  }
  const receiver = await DatingProfileRepository.findById(input.receiverProfileId);
  const prompts = readPrompts(receiver?.profilePrompts);
  if (!prompts.some((prompt) => prompt.promptId === input.targetId)) {
    throw new ValidationError('That prompt does not belong to the selected profile');
  }
  return input.targetId;
}

export class DatingMatchService {
  static async like(
    userId: string,
    input: {
      receiverProfileId: string;
      targetType: LikeTargetType;
      targetId?: string | null;
      comment?: string | null;
    },
  ) {
    return this.react(userId, { ...input, isPass: false });
  }

  static async pass(userId: string, receiverProfileId: string) {
    return this.react(userId, {
      receiverProfileId,
      targetType: LikeTargetType.PROFILE,
      targetId: null,
      comment: null,
      isPass: true,
    });
  }

  private static async react(
    userId: string,
    input: {
      receiverProfileId: string;
      targetType: LikeTargetType;
      targetId?: string | null;
      comment?: string | null;
      isPass: boolean;
    },
  ) {
    const sender = await requireDatingProfile(userId);
    if (sender.status !== DatingProfileStatus.ACTIVE) {
      throw new ForbiddenError('Activate your dating profile before liking or passing');
    }
    if (sender.id === input.receiverProfileId) {
      throw new ValidationError('You cannot like your own dating profile');
    }
    const receiver = await DatingProfileRepository.findById(input.receiverProfileId);
    if (!receiver || receiver.status !== DatingProfileStatus.ACTIVE) {
      throw new NotFoundError('Dating profile not found');
    }
    if (await DatingSafetyRepository.isEitherBlocked(sender.id, receiver.id)) {
      throw new ForbiddenError('This profile is unavailable');
    }
    const comment = input.comment?.trim() ? input.comment.trim() : null;
    if (comment && comment.length > DATING_COMMENT_MAX) {
      throw new ValidationError('comment must be 500 characters or fewer');
    }
    assertDatingTextAllowed(comment);
    const targetId = input.isPass
      ? null
      : await assertTarget({
          receiverProfileId: receiver.id,
          targetType: input.targetType,
          targetId: input.targetId,
        });
    const existing = await DatingLikeRepository.findPair(sender.id, receiver.id);
    if (existing && !existing.isPass) {
      throw new ConflictError('You already liked this profile');
    }
    if (existing && input.isPass)
      throw new ConflictError('You already passed this profile');
    if (!input.isPass) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sent = await DatingLikeRepository.countSince(sender.id, since, false);
      if (sent >= DATING_LIKE_LIMIT_PER_DAY) {
        throw new AppError(
          'You have reached the daily like limit',
          HTTP_STATUS.TOO_MANY_REQUESTS,
        );
      }
    }
    const like = existing
      ? await DatingLikeRepository.update(existing.id, {
          isPass: false,
          comment,
          targetType: input.targetType,
          targetId,
        })
      : await DatingLikeRepository.create({
          senderProfileId: sender.id,
          receiverProfileId: receiver.id,
          isPass: input.isPass,
          comment,
          targetType: input.isPass ? LikeTargetType.PROFILE : input.targetType,
          targetId,
        });
    if (input.isPass) return { passed: true, liked: false, isMatch: false, match: null };

    await DatingNotificationRepository.create({
      profileId: receiver.id,
      type: DatingNotificationType.NEW_LIKE,
      title: `${sender.displayName} liked you`,
      body: comment,
      relatedEntityId: like.id,
    });
    publishDating([receiver.userId], {
      type: 'like_received',
      likeId: like.id,
      senderProfileId: sender.id,
      receiverProfileId: receiver.id,
    });

    const reciprocal = await DatingLikeRepository.findPair(receiver.id, sender.id);
    if (!reciprocal || reciprocal.isPass) {
      return { liked: true, isMatch: false, match: null };
    }
    const pair = canonicalProfilePair(sender.id, receiver.id);
    const existingMatch = await DatingMatchRepository.findByPair(
      pair.profileLowId,
      pair.profileHighId,
    );
    if (existingMatch) {
      return {
        liked: true,
        isMatch: existingMatch.isActive,
        match: existingMatch.isActive
          ? await this.matchPayload(existingMatch, sender.id)
          : null,
      };
    }
    const created = await DatingMatchRepository.createWithConversation({
      ...pair,
      originatingLikeId: like.id,
      firstMessage: comment ? { senderProfileId: sender.id, body: comment } : null,
    });
    const payload = await this.matchPayload(created, sender.id);
    await Promise.all([
      DatingNotificationRepository.create({
        profileId: sender.id,
        type: DatingNotificationType.NEW_MATCH,
        title: `It's a match with ${receiver.displayName}`,
        body: comment,
        relatedEntityId: created.id,
      }),
      DatingNotificationRepository.create({
        profileId: receiver.id,
        type: DatingNotificationType.NEW_MATCH,
        title: `It's a match with ${sender.displayName}`,
        body: comment,
        relatedEntityId: created.id,
      }),
    ]);
    publishDating([sender.userId, receiver.userId], { type: 'match', match: payload });
    return { liked: true, isMatch: true, match: payload };
  }

  private static async matchPayload(
    match: NonNullable<Awaited<ReturnType<typeof DatingMatchRepository.findById>>>,
    viewerProfileId: string,
  ) {
    const other =
      match.profileLowId === viewerProfileId ? match.profileHigh : match.profileLow;
    const photo = primaryPhoto(other.photos);
    const conversation = match.conversation
      ? match.conversation
      : await DatingChatRepository.findByMatchId(match.id);
    const first = conversation
      ? await DatingChatRepository.latestOtherMessage(
          conversation.id,
          viewerProfileId === other.id ? match.profileLowId : viewerProfileId,
        )
      : null;
    return {
      id: match.id,
      matchedAt: match.matchedAt.toISOString(),
      isActive: match.isActive,
      matchedProfile: {
        id: other.id,
        displayName: other.displayName,
        primaryPhotoUrl: photo ? await signedDatingPhotoUrl(photo.objectKey) : null,
      },
      conversationId: conversation?.id ?? null,
      firstMessage: first
        ? { id: first.id, body: first.body, createdAt: first.createdAt.toISOString() }
        : null,
    };
  }

  static async listReceived(userId: string, page: number, limit: number) {
    const profile = await requireDatingProfile(userId);
    const [matched, blocked] = await Promise.all([
      DatingMatchRepository.partnerIds(profile.id),
      DatingSafetyRepository.blockedIds(profile.id),
    ]);
    const result = await DatingLikeRepository.listReceived({
      receiverProfileId: profile.id,
      excludedSenderIds: [...matched, ...blocked],
      skip: (page - 1) * limit,
      take: limit,
    });
    const items = await Promise.all(
      result.rows.map(async (like) => {
        const sender = like.senderProfile;
        const preview = await this.targetPreview(
          profile.id,
          like.targetType,
          like.targetId,
        );
        return {
          likeId: like.id,
          createdAt: like.createdAt.toISOString(),
          comment: like.comment,
          target: preview,
          senderProfile: await presentPublicProfile(sender, profile),
        };
      }),
    );
    return datingPage(items, result.total, page, limit);
  }

  static async listSent(userId: string, page: number, limit: number) {
    const profile = await requireDatingProfile(userId);
    const result = await DatingLikeRepository.listSent({
      senderProfileId: profile.id,
      skip: (page - 1) * limit,
      take: limit,
    });
    const items = await Promise.all(
      result.rows.map(async (like) => ({
        likeId: like.id,
        createdAt: like.createdAt.toISOString(),
        comment: like.comment,
        targetType: like.targetType,
        targetId: like.targetId,
        receiverProfile: await presentPublicProfile(like.receiverProfile, profile),
      })),
    );
    return datingPage(items, result.total, page, limit);
  }

  private static async targetPreview(
    receiverProfileId: string,
    targetType: LikeTargetType,
    targetId: string | null,
  ) {
    if (targetType === LikeTargetType.PHOTO && targetId) {
      const photo = await DatingPhotoRepository.findById(targetId);
      return {
        type: targetType,
        id: targetId,
        previewUrl:
          photo && photo.profileId === receiverProfileId
            ? await signedDatingPhotoUrl(photo.objectKey)
            : null,
      };
    }
    if (targetType === LikeTargetType.PROMPT && targetId) {
      const profile = await DatingProfileRepository.findById(receiverProfileId);
      const prompt = readPrompts(profile?.profilePrompts).find(
        (item) => item.promptId === targetId,
      );
      return {
        type: targetType,
        id: targetId,
        question: prompt?.question ?? null,
        answer: prompt?.answer ?? null,
      };
    }
    return { type: LikeTargetType.PROFILE, id: null };
  }

  static async listMatches(userId: string) {
    const profile = await requireDatingProfile(userId);
    const matches = await DatingMatchRepository.listForProfile(profile.id, true);
    return Promise.all(matches.map((match) => this.matchPayload(match, profile.id)));
  }

  static async getMatch(userId: string, matchId: string) {
    const profile = await requireDatingProfile(userId);
    const match = await DatingMatchRepository.findById(matchId);
    if (
      !match ||
      (match.profileLowId !== profile.id && match.profileHighId !== profile.id)
    ) {
      throw new NotFoundError('Match not found');
    }
    return this.matchPayload(match, profile.id);
  }

  static async unmatch(userId: string, matchId: string, reason?: string | null) {
    const profile = await requireDatingProfile(userId);
    const match = await DatingMatchRepository.findById(matchId);
    if (
      !match ||
      (match.profileLowId !== profile.id && match.profileHighId !== profile.id)
    ) {
      throw new NotFoundError('Match not found');
    }
    if (!match.isActive) throw new ConflictError('This match is already closed');
    const note = reason?.trim() ? reason.trim() : null;
    assertDatingTextAllowed(note);
    const updated = await DatingMatchRepository.unmatch({
      id: match.id,
      unmatchedById: profile.id,
      unmatchReason: note,
    });
    return {
      id: updated.id,
      isActive: updated.isActive,
      unmatchedAt: updated.unmatchedAt?.toISOString() ?? null,
    };
  }
}
