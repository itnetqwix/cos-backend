import {
  FriendshipRecord,
  FriendshipRepository,
} from '../repositories/friendship.repository.js';
import { ChatMessageRecord, ChatRepository } from '../repositories/chat.repository.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/response.js';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { publishChat } from './chat-realtime.js';
import {
  buildChatAttachmentKey,
  chatAttachmentKind,
  getStorageService,
  isAllowedChatContentType,
  parseChatAttachmentKey,
  type AllowedChatContentType,
} from './storage.service.js';

/**
 * One-to-one chat between accepted creator friends.
 *
 * Product rules that are NOT SPECIFIED in /docs/source:
 * - Body max length is 2000 characters.
 * - History page size defaults to 40 and caps at 100.
 * - Preview text is 80 characters.
 * - Attachment size reuses VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES (100MB).
 * - Image types reuse the avatar allowlist. Video types reuse submission types.
 * - Read state is a per-creator timestamp, not a per-message receipt table.
 */

export const CHAT_BODY_MAX = 2000;
export const CHAT_PAGE_DEFAULT = 40;
export const CHAT_PAGE_MAX = 100;
const PREVIEW_MAX = 80;

export interface ChatAttachmentInput {
  objectKey: string;
  contentType: string;
  byteSize: number;
}

export interface ChatAttachmentView {
  kind: 'IMAGE' | 'VIDEO';
  contentType: string;
  byteSize: number;
  url: string | null;
}

export interface ChatMessageView {
  id: string;
  friendshipId: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  read: boolean;
  attachment: ChatAttachmentView | null;
}

export interface ChatPeer {
  id: string;
  name: string;
  avatarObjectKey: string | null;
}

export interface ChatConversationView {
  friendshipId: string;
  peer: ChatPeer;
  unreadCount: number;
  lastMessage: {
    id: string;
    senderId: string;
    preview: string;
    createdAt: string;
  } | null;
}

function otherId(row: FriendshipRecord, actorId: string): string {
  return row.userLowId === actorId ? row.userHighId : row.userLowId;
}

function peerOf(row: FriendshipRecord, actorId: string): ChatPeer {
  const user = row.userLowId === actorId ? row.userHigh : row.userLow;
  return { id: user.id, name: user.name, avatarObjectKey: user.avatarObjectKey };
}

async function requireAccepted(
  actorId: string,
  friendshipId: string,
): Promise<FriendshipRecord> {
  const row = await FriendshipRepository.findById(friendshipId);
  if (!row || (row.userLowId !== actorId && row.userHighId !== actorId)) {
    throw new NotFoundError('Conversation not found');
  }
  if (row.status !== 'ACCEPTED') {
    throw new ForbiddenError('Chat is available only between accepted friends');
  }
  return row;
}

function assertByteSize(byteSize: number): void {
  if (!Number.isInteger(byteSize) || byteSize < 1) {
    throw new ValidationError('Attachment size is invalid');
  }
  if (byteSize > VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `Attachment cannot exceed ${VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES} bytes`,
    );
  }
}

function assertChatType(contentType: string): AllowedChatContentType {
  if (!isAllowedChatContentType(contentType)) {
    throw new ValidationError(
      'Attachment must be a JPEG, PNG, WebP, GIF, MP4, WebM, or MOV',
    );
  }
  return contentType;
}

export function messagePreview(message: {
  body: string | null;
  attachmentKind: 'IMAGE' | 'VIDEO' | null;
}): string {
  const text = message.body?.trim();
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
  if (message.attachmentKind === 'IMAGE') return 'Photo';
  if (message.attachmentKind === 'VIDEO') return 'Video';
  return 'Message';
}

async function signedAttachment(
  message: ChatMessageRecord,
): Promise<ChatAttachmentView | null> {
  if (!message.attachmentKey || !message.attachmentKind || !message.attachmentMime) {
    return null;
  }
  if (!parseChatAttachmentKey(message.attachmentKey)) return null;
  let url: string | null = null;
  try {
    const storage = getStorageService();
    if (storage.createPresignedDownload) {
      url = await storage.createPresignedDownload(message.attachmentKey);
    }
  } catch {
    url = null;
  }
  return {
    kind: message.attachmentKind,
    contentType: message.attachmentMime,
    byteSize: message.attachmentBytes ?? 0,
    url,
  };
}

async function toView(
  message: ChatMessageRecord,
  peerReadAt: Date | null,
): Promise<ChatMessageView> {
  const attachment = await signedAttachment(message);
  const view: ChatMessageView = {
    id: message.id,
    friendshipId: message.friendshipId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    read: peerReadAt !== null && message.createdAt <= peerReadAt,
    attachment,
  };
  return view;
}

function assertAttachmentOwnership(
  actorId: string,
  friendshipId: string,
  input: ChatAttachmentInput,
): {
  objectKey: string;
  contentType: AllowedChatContentType;
  byteSize: number;
  kind: 'IMAGE' | 'VIDEO';
} {
  assertByteSize(input.byteSize);
  const contentType = assertChatType(input.contentType);
  const parsed = parseChatAttachmentKey(input.objectKey);
  if (!parsed) {
    throw new ValidationError('objectKey is not a backend-issued chat attachment');
  }
  if (parsed.friendshipId !== friendshipId || parsed.senderId !== actorId) {
    throw new ForbiddenError(
      'Forbidden: attachment does not belong to this conversation',
    );
  }
  const expected = contentType.startsWith('image/')
    ? ['jpg', 'png', 'webp', 'gif']
    : ['mp4', 'webm', 'mov'];
  if (!expected.includes(parsed.extension)) {
    throw new ValidationError('Attachment type does not match the uploaded file');
  }
  return {
    objectKey: input.objectKey,
    contentType,
    byteSize: input.byteSize,
    kind: chatAttachmentKind(contentType),
  };
}

export class ChatService {
  static async listConversations(actorId: string): Promise<ChatConversationView[]> {
    const rows = await FriendshipRepository.listForUser(actorId);
    const accepted = rows.filter((row) => row.status === 'ACCEPTED');
    const conversations = await Promise.all(
      accepted.map(async (row) => {
        const [latest, readAt] = await Promise.all([
          ChatRepository.latestMessage(row.id),
          ChatRepository.getRead(row.id, actorId),
        ]);
        const unreadCount = await ChatRepository.countUnread(row.id, actorId, readAt);
        return {
          friendshipId: row.id,
          peer: peerOf(row, actorId),
          unreadCount,
          lastMessage: latest
            ? {
                id: latest.id,
                senderId: latest.senderId,
                preview: messagePreview(latest),
                createdAt: latest.createdAt.toISOString(),
              }
            : null,
          sortAt: latest?.createdAt.getTime() ?? row.updatedAt.getTime(),
        };
      }),
    );
    conversations.sort((a, b) => b.sortAt - a.sortAt);
    return conversations.map(({ sortAt: _sortAt, ...item }) => item);
  }

  static async listMessages(
    actorId: string,
    friendshipId: string,
    before: Date | null,
    limit: number,
  ): Promise<{ messages: ChatMessageView[]; nextBefore: string | null }> {
    const row = await requireAccepted(actorId, friendshipId);
    const take = Math.min(Math.max(limit || CHAT_PAGE_DEFAULT, 1), CHAT_PAGE_MAX);
    const page = await ChatRepository.listMessages(friendshipId, before, take + 1);
    const hasMore = page.length > take;
    const slice = hasMore ? page.slice(0, take) : page;
    const peerReadAt = await ChatRepository.getRead(row.id, otherId(row, actorId));
    const ascending = [...slice].reverse();
    const messages = await Promise.all(
      ascending.map((message) => toView(message, peerReadAt)),
    );
    const oldest = slice[slice.length - 1];
    return {
      messages,
      nextBefore: hasMore && oldest ? oldest.createdAt.toISOString() : null,
    };
  }

  static async sendMessage(
    actorId: string,
    friendshipId: string,
    input: { body?: string; attachment?: ChatAttachmentInput },
  ): Promise<ChatMessageView> {
    const row = await requireAccepted(actorId, friendshipId);
    const text = input.body?.trim() ?? '';
    if (text.length > CHAT_BODY_MAX) {
      throw new ValidationError(`Message cannot exceed ${CHAT_BODY_MAX} characters`);
    }
    const attachment = input.attachment
      ? assertAttachmentOwnership(actorId, friendshipId, input.attachment)
      : null;
    if (!text && !attachment) {
      throw new ValidationError('Message text or an attachment is required');
    }

    const saved = await ChatRepository.createMessage({
      friendshipId,
      senderId: actorId,
      body: text || null,
      attachmentKey: attachment?.objectKey ?? null,
      attachmentKind: attachment?.kind ?? null,
      attachmentMime: attachment?.contentType ?? null,
      attachmentBytes: attachment?.byteSize ?? null,
    });
    const peerReadAt = await ChatRepository.getRead(row.id, otherId(row, actorId));
    const view = await toView(saved, peerReadAt);
    publishChat([row.userLowId, row.userHighId], {
      type: 'message',
      friendshipId,
      message: view,
    });
    return view;
  }

  static async markRead(
    actorId: string,
    friendshipId: string,
  ): Promise<{ lastReadAt: string }> {
    const row = await requireAccepted(actorId, friendshipId);
    const lastReadAt = await ChatRepository.markRead(friendshipId, actorId, new Date());
    const iso = lastReadAt.toISOString();
    publishChat([row.userLowId, row.userHighId], {
      type: 'read',
      friendshipId,
      userId: actorId,
      lastReadAt: iso,
    });
    return { lastReadAt: iso };
  }

  static async presignAttachment(
    actorId: string,
    input: { friendshipId: string; contentType: string; fileSizeBytes: number },
  ) {
    await requireAccepted(actorId, input.friendshipId);
    assertByteSize(input.fileSizeBytes);
    const contentType = assertChatType(input.contentType);
    const objectKey = buildChatAttachmentKey({
      friendshipId: input.friendshipId,
      senderId: actorId,
      contentType,
    });
    const signed = await getStorageService().createPresignedUpload({
      objectKey,
      contentType,
      contentLength: input.fileSizeBytes,
    });
    return {
      uploadUrl: signed.uploadUrl,
      objectKey: signed.objectKey,
      headers: signed.headers,
      expiresInSeconds: signed.expiresInSeconds,
      method: signed.method,
    };
  }
}
