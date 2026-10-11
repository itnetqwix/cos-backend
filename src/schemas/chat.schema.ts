import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { CHAT_ATTACHMENT_CONTENT_TYPES } from '../services/storage.service.js';
import { CHAT_BODY_MAX, CHAT_PAGE_MAX } from '../services/chat.service.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

const chatContentTypes = Object.keys(CHAT_ATTACHMENT_CONTENT_TYPES) as [
  keyof typeof CHAT_ATTACHMENT_CONTENT_TYPES,
  ...(keyof typeof CHAT_ATTACHMENT_CONTENT_TYPES)[],
];

export const chatFriendshipParamSchema = z.object({
  id: z.string().uuid('Friendship id must be a UUID'),
});

export const chatHistoryQuerySchema = z.object({
  before: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'before must be a datetime')
    .optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_PAGE_MAX).optional(),
});

export const sendChatMessageSchema = z
  .object({
    body: z.string().trim().max(CHAT_BODY_MAX).optional(),
    attachment: z
      .object({
        objectKey: z.string().trim().min(1).max(300),
        contentType: z.enum(chatContentTypes),
        byteSize: z.number().int().positive().max(VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES),
      })
      .optional(),
  })
  .strict();

export const presignChatAttachmentSchema = z
  .object({
    friendshipId: z.string().uuid('Friendship id must be a UUID'),
    contentType: z.enum(chatContentTypes),
    fileSizeBytes: z.number().int().positive().max(VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES),
  })
  .strict();

const creatorOnly =
  'CREATOR only. Guests receive 401. ADMIN receives 403. Blocked creators are rejected. A creator who is not an accepted friend of the conversation receives 404, or 403 when the friendship is still pending. AWS credentials are not returned. Objects stay in the private bucket and are played back with a presigned GET.';

const peerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
};

const attachmentSchema = {
  type: 'object',
  nullable: true,
  properties: {
    kind: { type: 'string', enum: ['IMAGE', 'VIDEO'] },
    contentType: { type: 'string' },
    byteSize: { type: 'integer' },
    url: { type: 'string', nullable: true },
  },
};

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    friendshipId: { type: 'string', format: 'uuid' },
    senderId: { type: 'string', format: 'uuid' },
    body: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    read: { type: 'boolean' },
    attachment: attachmentSchema,
  },
};

const conversationSchema = {
  type: 'object',
  properties: {
    friendshipId: { type: 'string', format: 'uuid' },
    peer: peerSchema,
    unreadCount: { type: 'integer' },
    lastMessage: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        senderId: { type: 'string' },
        preview: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};

const errors = {
  400: swaggerErrorEnvelope('Validation error'),
  401: swaggerErrorEnvelope('Unauthorized'),
  403: swaggerErrorEnvelope('Forbidden'),
  404: swaggerErrorEnvelope('Conversation not found'),
};

export const listChatConversationsSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'List accepted-friend conversations',
  description: creatorOnly,
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: conversationSchema },
      'Conversations retrieved successfully',
    ),
    ...errors,
  },
};

export const listChatMessagesSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Conversation history',
  description: `${creatorOnly} Newest page first in storage, returned oldest-first. before is an exclusive ISO timestamp.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  querystring: {
    type: 'object',
    properties: {
      before: { type: 'string', format: 'date-time' },
      limit: { type: 'integer', minimum: 1, maximum: CHAT_PAGE_MAX },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          messages: { type: 'array', items: messageSchema },
          nextBefore: { type: 'string', nullable: true },
        },
      },
      'Messages retrieved successfully',
    ),
    ...errors,
  },
};

export const sendChatMessageSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Send a text or attachment message',
  description: `${creatorOnly} body may include emoji. At least one of body or attachment is required.`,
  security: [{ bearerAuth: [] }],
  params: idParams,
  body: {
    type: 'object',
    properties: {
      body: { type: 'string' },
      attachment: {
        type: 'object',
        properties: {
          objectKey: { type: 'string' },
          contentType: { type: 'string' },
          byteSize: { type: 'integer' },
        },
      },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(messageSchema, 'Message sent'),
    ...errors,
  },
};

export const markChatReadSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Mark a conversation read',
  description: creatorOnly,
  security: [{ bearerAuth: [] }],
  params: idParams,
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: { lastReadAt: { type: 'string', format: 'date-time' } },
      },
      'Conversation marked read',
    ),
    ...errors,
  },
};

export const presignChatAttachmentSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Presign a private chat attachment upload',
  description: `${creatorOnly} The response is a presigned PUT. It does not include AWS keys, and the object is not made public.`,
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['friendshipId', 'contentType', 'fileSizeBytes'],
    properties: {
      friendshipId: { type: 'string', format: 'uuid' },
      contentType: { type: 'string' },
      fileSizeBytes: { type: 'integer' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          uploadUrl: { type: 'string' },
          objectKey: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          expiresInSeconds: { type: 'integer' },
          method: { type: 'string' },
        },
      },
      'Upload URL created',
    ),
    ...errors,
  },
};

export const chatStreamSwaggerSchema: FastifySchema = {
  tags: ['Chat'],
  summary: 'Server-sent events for new messages and read receipts',
  description: `${creatorOnly} text/event-stream. No WebSocket dependency. Events are message and read.`,
  security: [{ bearerAuth: [] }],
  response: {
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};
