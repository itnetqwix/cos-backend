import {
  ChatAttachmentKind,
  DatingNotificationType,
  DatingProfileStatus,
  DatingReportCategory,
} from '@prisma/client';
import { DatingChatRepository } from '../repositories/dating-chat.repository.js';
import { DatingMatchRepository } from '../repositories/dating-match.repository.js';
import {
  DatingSafetyRepository,
  DatingNotificationRepository,
} from '../repositories/dating-safety.repository.js';
import { DatingProfileRepository } from '../repositories/dating-profile.repository.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';
import { requireDatingProfile } from './dating-access.js';
import {
  DATING_AUTO_BAN_SOLICITATIONS,
  DATING_AUTO_PAUSE_REPORTS,
  DATING_MESSAGE_LIMIT_PER_MINUTE,
  DATING_MESSAGE_MAX,
} from './dating-constants.js';
import { findProhibitedTerm } from './dating-policy.js';
import { publishDating } from './dating-realtime.js';
import { primaryPhoto } from './dating-view.js';
import {
  assertDatingImageSize,
  buildDatingChatAttachmentKey,
  getStorageService,
  parseDatingChatAttachmentKey,
  signedDatingPhotoUrl,
} from './storage.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadConversation(userId: string, conversationId: string) {
  const profile = await requireDatingProfile(userId);
  const conversation = await DatingChatRepository.findById(conversationId);
  if (!conversation) throw new NotFoundError('Conversation not found');
  const match = conversation.match;
  if (match.profileLowId !== profile.id && match.profileHighId !== profile.id) {
    throw new NotFoundError('Conversation not found');
  }
  if (!match.isActive || profile.status === DatingProfileStatus.BANNED) {
    throw new ForbiddenError('This conversation is closed');
  }
  const otherId =
    match.profileLowId === profile.id ? match.profileHighId : match.profileLowId;
  if (await DatingSafetyRepository.isEitherBlocked(profile.id, otherId)) {
    throw new ForbiddenError('This conversation is closed');
  }
  return { profile, conversation, otherId };
}

async function presentMessage(message: {
  id: string;
  conversationId: string;
  senderProfileId: string;
  body: string | null;
  attachmentKey: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderProfileId: message.senderProfileId,
    body: message.body,
    attachmentUrl: message.attachmentKey
      ? await signedDatingPhotoUrl(message.attachmentKey)
      : null,
    isRead: message.isRead,
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

export class DatingChatService {
  static async list(userId: string) {
    const profile = await requireDatingProfile(userId);
    const matches = await DatingMatchRepository.listForProfile(profile.id, true);
    const conversations = await DatingChatRepository.listForMatches(
      matches.map((match) => match.id),
    );
    const unread = await DatingChatRepository.unreadCounts(
      conversations.map((conversation) => conversation.id),
      profile.id,
    );
    return Promise.all(
      conversations.map(async (conversation) => {
        const match = matches.find((item) => item.id === conversation.matchId);
        const other = match
          ? match.profileLowId === profile.id
            ? match.profileHigh
            : match.profileLow
          : null;
        const photo = other ? primaryPhoto(other.photos) : null;
        const last = conversation.messages[0] ?? null;
        return {
          id: conversation.id,
          matchId: conversation.matchId,
          lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
          lastMessageSnippet: conversation.lastMessageSnippet,
          peer: other
            ? {
                id: other.id,
                displayName: other.displayName,
                primaryPhotoUrl: photo
                  ? await signedDatingPhotoUrl(photo.objectKey)
                  : null,
              }
            : null,
          lastMessage: last ? await presentMessage(last) : null,
          unreadCount: unread.get(conversation.id) ?? 0,
        };
      }),
    );
  }

  static async messages(
    userId: string,
    conversationId: string,
    page: number,
    limit: number,
  ) {
    await loadConversation(userId, conversationId);
    const result = await DatingChatRepository.listMessages({
      conversationId,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: await Promise.all(result.rows.map((row) => presentMessage(row))),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
    };
  }

  static async send(
    userId: string,
    conversationId: string,
    input: {
      body?: string | null;
      attachment?: { objectKey: string; contentType: string; byteSize: number } | null;
    },
  ) {
    const { profile, otherId } = await loadConversation(userId, conversationId);
    const since = new Date(Date.now() - 60 * 1000);
    const recent = await DatingChatRepository.countSince(profile.id, since);
    if (recent >= DATING_MESSAGE_LIMIT_PER_MINUTE) {
      throw new AppError('Too many messages', HTTP_STATUS.TOO_MANY_REQUESTS);
    }
    const body = input.body?.trim() ? input.body.trim() : null;
    if (body && body.length > DATING_MESSAGE_MAX) {
      throw new ValidationError('Messages must be 2000 characters or fewer');
    }
    if (!body && !input.attachment)
      throw new ValidationError('Message body or attachment is required');
    if (body && findProhibitedTerm(body)) {
      await this.recordPolicyViolation(profile.id, otherId, body);
      throw new ValidationError(
        'Your text contains prohibited terms. Ripskis strictly prohibits commercial drug sales, pricing, or off-platform handles.',
      );
    }
    let attachmentKey: string | null = null;
    let attachmentMime: string | null = null;
    let attachmentBytes: number | null = null;
    if (input.attachment) {
      const parsed = parseDatingChatAttachmentKey(input.attachment.objectKey);
      if (
        !parsed ||
        parsed.conversationId !== conversationId ||
        parsed.senderProfileId !== profile.id
      ) {
        throw new ValidationError('Attachment key does not belong to this conversation');
      }
      assertDatingImageSize(input.attachment.byteSize);
      const expected = buildDatingChatAttachmentKey({
        conversationId,
        senderProfileId: profile.id,
        contentType: input.attachment.contentType,
        objectId: parsed.objectId,
      });
      if (expected !== input.attachment.objectKey) {
        throw new ValidationError('Attachment content type does not match the key');
      }
      attachmentKey = input.attachment.objectKey;
      attachmentMime = input.attachment.contentType;
      attachmentBytes = input.attachment.byteSize;
    }
    const message = await DatingChatRepository.createMessage({
      conversationId,
      senderProfileId: profile.id,
      body,
      attachmentKey,
      attachmentKind: attachmentKey ? ChatAttachmentKind.IMAGE : null,
      attachmentMime,
      attachmentBytes,
    });
    const view = await presentMessage(message);
    const other = await DatingProfileRepository.findById(otherId);
    if (other) {
      await DatingNotificationRepository.create({
        profileId: other.id,
        type: DatingNotificationType.NEW_MESSAGE,
        title: `New message from ${profile.displayName}`,
        body,
        relatedEntityId: conversationId,
      });
      publishDating([other.userId], { type: 'message', conversationId, message: view });
    }
    return view;
  }

  private static async recordPolicyViolation(
    reportedProfileId: string,
    reporterProfileId: string,
    excerpt: string,
  ) {
    await DatingSafetyRepository.createReport({
      reporterProfileId,
      reportedProfileId,
      reasonCategory: DatingReportCategory.SOLICITATION_OR_DRUG_DEALING,
      details: `Automated policy screen blocked a message. Excerpt: ${excerpt.slice(0, 240)}`,
    });
    const since = new Date(Date.now() - DAY_MS);
    const recent = await DatingSafetyRepository.recentAgainst(reportedProfileId, since);
    const solicitations = recent.filter(
      (row) => row.reasonCategory === DatingReportCategory.SOLICITATION_OR_DRUG_DEALING,
    ).length;
    const distinct = new Set(recent.map((row) => row.reporterProfileId));
    if (solicitations >= DATING_AUTO_BAN_SOLICITATIONS) {
      await DatingProfileRepository.updateStatus(
        reportedProfileId,
        DatingProfileStatus.BANNED,
      );
      return;
    }
    if (distinct.size >= DATING_AUTO_PAUSE_REPORTS) {
      await DatingProfileRepository.updateStatus(
        reportedProfileId,
        DatingProfileStatus.PAUSED,
      );
    }
  }

  static async markRead(userId: string, conversationId: string) {
    const { profile, otherId } = await loadConversation(userId, conversationId);
    const readAt = new Date();
    const result = await DatingChatRepository.markRead(
      conversationId,
      profile.id,
      readAt,
    );
    await DatingNotificationRepository.markRelatedRead(
      profile.id,
      DatingNotificationType.NEW_MESSAGE,
      conversationId,
      readAt,
    );
    const other = await DatingProfileRepository.findById(otherId);
    if (other) {
      publishDating([other.userId], {
        type: 'read',
        conversationId,
        userId,
        profileId: profile.id,
        lastReadAt: readAt.toISOString(),
      });
    }
    return {
      conversationId,
      lastReadAt: readAt.toISOString(),
      updatedCount: result.count,
    };
  }

  static async presignAttachment(
    userId: string,
    conversationId: string,
    contentType: string,
    fileSizeBytes: number,
  ) {
    const { profile } = await loadConversation(userId, conversationId);
    assertDatingImageSize(fileSizeBytes);
    const objectKey = buildDatingChatAttachmentKey({
      conversationId,
      senderProfileId: profile.id,
      contentType,
    });
    return getStorageService().createPresignedUpload({
      objectKey,
      contentType,
      contentLength: fileSizeBytes,
    });
  }
}
