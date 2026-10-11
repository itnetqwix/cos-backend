import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { FriendshipRepository } from '../../src/repositories/friendship.repository.js';
import { ChatMessageRecord, ChatRepository } from '../../src/repositories/chat.repository.js';
import {
  CHAT_BODY_MAX,
  ChatService,
  messagePreview,
} from '../../src/services/chat.service.js';
import { publishChat, resetChatListeners, subscribeChat } from '../../src/services/chat-realtime.js';
import {
  getStorageService,
  setStorageService,
  type StorageService,
} from '../../src/services/storage.service.js';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/utils/response.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const meUser = { id: ME, name: 'Ada', avatarObjectKey: null };
const themUser = { id: THEM, name: 'Bea', avatarObjectKey: null };

function friendship(status: 'PENDING' | 'ACCEPTED') {
  return {
    id: ROW_ID,
    userLowId: ME,
    userHighId: THEM,
    requesterId: ME,
    status,
    createdAt: new Date('2026-10-11T00:00:00.000Z'),
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
    userLow: meUser,
    userHigh: themUser,
  };
}

function chatKey(senderId: string, extension = 'jpg') {
  return `chat/${ROW_ID}/${senderId}/${OBJECT_ID}.${extension}`;
}

const originals = {
  findById: FriendshipRepository.findById,
  listForUser: FriendshipRepository.listForUser,
  createMessage: ChatRepository.createMessage,
  listMessages: ChatRepository.listMessages,
  latestMessage: ChatRepository.latestMessage,
  countUnread: ChatRepository.countUnread,
  getRead: ChatRepository.getRead,
  markRead: ChatRepository.markRead,
};

let previousStorage: StorageService | null = null;

after(() => {
  Object.assign(FriendshipRepository, {
    findById: originals.findById,
    listForUser: originals.listForUser,
  });
  Object.assign(ChatRepository, {
    createMessage: originals.createMessage,
    listMessages: originals.listMessages,
    latestMessage: originals.latestMessage,
    countUnread: originals.countUnread,
    getRead: originals.getRead,
    markRead: originals.markRead,
  });
  setStorageService(previousStorage);
  resetChatListeners();
});

function installMemory() {
  const messages: ChatMessageRecord[] = [];
  const reads = new Map<string, Date>();
  let sequence = 0;

  ChatRepository.createMessage = async (data) => {
    sequence += 1;
    const row: ChatMessageRecord = {
      id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      friendshipId: data.friendshipId,
      senderId: data.senderId,
      body: data.body,
      attachmentKey: data.attachmentKey,
      attachmentKind: data.attachmentKind,
      attachmentMime: data.attachmentMime,
      attachmentBytes: data.attachmentBytes,
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, sequence)),
    };
    messages.push(row);
    return row;
  };
  ChatRepository.listMessages = async (friendshipId, before, take) =>
    messages
      .filter(
        (message) =>
          message.friendshipId === friendshipId &&
          (!before || message.createdAt < before),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  ChatRepository.latestMessage = async (friendshipId) => {
    const rows = messages.filter((message) => message.friendshipId === friendshipId);
    return rows[rows.length - 1] ?? null;
  };
  ChatRepository.getRead = async (friendshipId, userId) =>
    reads.get(`${friendshipId}:${userId}`) ?? null;
  ChatRepository.markRead = async (friendshipId, userId, lastReadAt) => {
    reads.set(`${friendshipId}:${userId}`, lastReadAt);
    return lastReadAt;
  };
  ChatRepository.countUnread = async (friendshipId, userId, lastReadAt) =>
    messages.filter(
      (message) =>
        message.friendshipId === friendshipId &&
        message.senderId !== userId &&
        (!lastReadAt || message.createdAt > lastReadAt),
    ).length;
  return messages;
}

describe('creator chat', { concurrency: false }, () => {
  before(() => {
    try {
      previousStorage = getStorageService();
    } catch {
      previousStorage = null;
    }
  });

  it('adds chat tables without altering contest, submission, or rating tables', () => {
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const sql = readFileSync(
      path.join(ROOT, 'prisma/migrations/20261011220000_creator_chat/migration.sql'),
      'utf8',
    );
    assert.match(schema, /model ChatMessage/);
    assert.match(schema, /model ChatRead/);
    assert.match(sql, /CREATE TABLE "chat_messages"/);
    assert.match(sql, /CREATE TABLE "chat_reads"/);
    assert.match(sql, /chat participant is not an accepted friend/);
    assert.doesNotMatch(sql, /ALTER TABLE "(submissions|ratings|contests)"/);
    assert.doesNotMatch(sql, /DROP TABLE/);
    assert.doesNotMatch(sql, /public-read/);
  });

  it('counts unread from the other creator and clears it on read', async () => {
    installMemory();
    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    FriendshipRepository.listForUser = async () => [friendship('ACCEPTED')];

    await ChatService.sendMessage(THEM, ROW_ID, { body: 'hello 😀' });
    await ChatService.sendMessage(THEM, ROW_ID, { body: 'again' });

    const before = await ChatService.listConversations(ME);
    assert.equal(before.length, 1);
    assert.equal(before[0].unreadCount, 2);
    assert.equal(before[0].lastMessage?.preview, 'again');
    assert.equal(before[0].peer.id, THEM);

    const marked = await ChatService.markRead(ME, ROW_ID);
    assert.ok(marked.lastReadAt);

    const afterRead = await ChatService.listConversations(ME);
    assert.equal(afterRead[0].unreadCount, 0);

    const mine = await ChatService.listMessages(THEM, ROW_ID, null, 40);
    assert.equal(mine.messages.length, 2);
    assert.equal(mine.messages[0].body, 'hello 😀');
    assert.equal(mine.messages.every((message) => message.read), true);
  });

  it('rejects empty messages, oversized text, pending friends, and outsiders', async () => {
    installMemory();
    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    await assert.rejects(
      () => ChatService.sendMessage(ME, ROW_ID, {}),
      (error: unknown) => error instanceof ValidationError,
    );
    await assert.rejects(
      () => ChatService.sendMessage(ME, ROW_ID, { body: 'x'.repeat(CHAT_BODY_MAX + 1) }),
      (error: unknown) => error instanceof ValidationError,
    );

    FriendshipRepository.findById = async () => friendship('PENDING');
    await assert.rejects(
      () => ChatService.sendMessage(ME, ROW_ID, { body: 'hi' }),
      (error: unknown) => error instanceof ForbiddenError,
    );
    await assert.rejects(
      () => ChatService.listMessages(ME, ROW_ID, null, 20),
      (error: unknown) => error instanceof ForbiddenError,
    );

    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    await assert.rejects(
      () => ChatService.listMessages(STRANGER, ROW_ID, null, 20),
      (error: unknown) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => ChatService.sendMessage(STRANGER, ROW_ID, { body: 'nope' }),
      (error: unknown) => error instanceof NotFoundError,
    );
    FriendshipRepository.findById = async () => null;
    await assert.rejects(
      () => ChatService.markRead(ME, ROW_ID),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  it('presigns a private attachment and rejects the wrong type, size, and owner', async () => {
    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    let captured: { contentLength?: number; contentType?: string; objectKey?: string } = {};
    setStorageService({
      async createPresignedUpload(request) {
        captured = request;
        return {
          uploadUrl: 'https://signed.example/upload?X-Amz-Signature=test',
          objectKey: request.objectKey,
          headers: { 'Content-Type': request.contentType },
          expiresInSeconds: 900,
          method: 'PUT',
        };
      },
      async createPresignedDownload(objectKey) {
        return `https://signed.example/get?key=${encodeURIComponent(objectKey)}`;
      },
    });

    const signed = await ChatService.presignAttachment(ME, {
      friendshipId: ROW_ID,
      contentType: 'image/png',
      fileSizeBytes: 1200,
    });
    assert.equal(captured.contentLength, 1200);
    assert.equal(captured.contentType, 'image/png');
    assert.match(signed.objectKey, new RegExp(`^chat/${ROW_ID}/${ME}/`));
    assert.equal(signed.method, 'PUT');
    assert.doesNotMatch(JSON.stringify(signed), /AKIA|aws_secret|public-read/i);

    await assert.rejects(
      () =>
        ChatService.presignAttachment(ME, {
          friendshipId: ROW_ID,
          contentType: 'text/plain',
          fileSizeBytes: 10,
        }),
      (error: unknown) => error instanceof ValidationError,
    );
    await assert.rejects(
      () =>
        ChatService.presignAttachment(ME, {
          friendshipId: ROW_ID,
          contentType: 'image/jpeg',
          fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
        }),
      (error: unknown) => error instanceof ValidationError,
    );

    FriendshipRepository.findById = async () => friendship('PENDING');
    await assert.rejects(
      () =>
        ChatService.presignAttachment(ME, {
          friendshipId: ROW_ID,
          contentType: 'image/jpeg',
          fileSizeBytes: 10,
        }),
      (error: unknown) => error instanceof ForbiddenError,
    );

    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    installMemory();
    await assert.rejects(
      () =>
        ChatService.sendMessage(ME, ROW_ID, {
          attachment: {
            objectKey: chatKey(THEM, 'png'),
            contentType: 'image/png',
            byteSize: 1200,
          },
        }),
      (error: unknown) => error instanceof ForbiddenError,
    );

    const sent = await ChatService.sendMessage(ME, ROW_ID, {
      body: 'look',
      attachment: {
        objectKey: chatKey(ME, 'png'),
        contentType: 'image/png',
        byteSize: 1200,
      },
    });
    const packed = JSON.stringify(sent);
    assert.equal(sent.attachment?.kind, 'IMAGE');
    assert.match(sent.attachment?.url ?? '', /signed\.example\/get/);
    assert.equal(sent.body, 'look');
    assert.doesNotMatch(packed, /attachmentKey|AKIA|public-read/);
    assert.equal(messagePreview({ body: null, attachmentKind: 'VIDEO' }), 'Video');
  });

  it('publishes a message to both friends and not to anyone else', async () => {
    installMemory();
    FriendshipRepository.findById = async () => friendship('ACCEPTED');
    const heard: string[] = [];
    const stopMe = subscribeChat(ME, () => heard.push(ME));
    const stopThem = subscribeChat(THEM, () => heard.push(THEM));
    const stopStranger = subscribeChat(STRANGER, () => heard.push(STRANGER));
    await ChatService.sendMessage(ME, ROW_ID, { body: 'live' });
    publishChat([ME], {
      type: 'read',
      friendshipId: ROW_ID,
      userId: ME,
      lastReadAt: '2026-10-11T00:00:00.000Z',
    });
    stopMe();
    stopThem();
    stopStranger();
    assert.deepEqual(heard, [ME, THEM, ME]);
    assert.equal(heard.includes(STRANGER), false);
  });
});

describe('creator chat routes deny guests and admins', { concurrency: false }, () => {
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  const guarded = [
    ['GET', '/api/v1/chat/conversations'],
    ['GET', '/api/v1/chat/stream'],
    ['POST', '/api/v1/chat/attachments/presign'],
    ['GET', `/api/v1/chat/conversations/${ROW_ID}/messages`],
    ['POST', `/api/v1/chat/conversations/${ROW_ID}/messages`],
    ['POST', `/api/v1/chat/conversations/${ROW_ID}/read`],
  ] as const;

  for (const [method, url] of guarded) {
    it(`${method} ${url} is 401 without a token`, async () => {
      const res = await app.inject({
        method,
        url,
        payload: { friendshipId: ROW_ID, contentType: 'image/png', fileSizeBytes: 10, body: 'hi' },
      });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.payload) as { success: boolean; data: null };
      assert.equal(body.success, false);
      assert.equal(body.data, null);
    });

    it(`${method} ${url} is 403 for ADMIN`, async () => {
      const token = app.jwt.sign({
        id: ME,
        email: 'admin@ripskis.com',
        role: Role.ADMIN,
      });
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: { friendshipId: ROW_ID, contentType: 'image/png', fileSizeBytes: 10, body: 'hi' },
      });
      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.payload) as { success: boolean; message: string };
      assert.equal(body.success, false);
      assert.match(body.message, /Forbidden/);
    });
  }

  it('registers chat routes on the creator guard', () => {
    const routes = readFileSync(path.join(ROOT, 'src/routes/index.ts'), 'utf8');
    const start = routes.indexOf('// Creator chat.');
    const end = routes.indexOf('// Contests (/api/v1/contests)');
    const block = routes.slice(start, end);
    assert.equal(block.match(/onRequest: creatorGuards/g)?.length, 6);
    assert.doesNotMatch(block, /Role\.ADMIN/);
  });
});
