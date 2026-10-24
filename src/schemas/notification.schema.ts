import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * In-app notification HTTP contracts.
 *
 * Every route is scoped to request.user.id. ADMIN and CREATOR both read
 * their own notifications. Guests receive 401.
 */

export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Notification id must be a valid UUID'),
});

const notificationDataSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string', nullable: true },
    submissionId: { type: 'string', nullable: true },
    readAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
  },
};

const guardsDescription =
  'Requires Authorization: Bearer <token>. Returns only the caller’s rows.';

export const listNotificationsSwaggerSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: 'List my notifications',
  description: `${guardsDescription} Newest first, at most 30 rows, plus the total unread count.`,
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          items: { type: 'array', items: notificationDataSchema },
          unreadCount: { type: 'integer' },
        },
      },
      'Notifications retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized access'),
  },
};

export const markNotificationReadSwaggerSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: 'Mark one notification as read',
  description: `${guardsDescription} Marking an already-read notification is a no-op.`,
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'null' }, 'Notification marked as read'),
    401: swaggerErrorEnvelope('Unauthorized access'),
    404: swaggerErrorEnvelope('Notification not found'),
  },
};

export const markAllNotificationsReadSwaggerSchema: FastifySchema = {
  tags: ['Notifications'],
  summary: 'Mark all my notifications as read',
  description: guardsDescription,
  response: {
    200: swaggerSuccessEnvelope({ type: 'null' }, 'All notifications marked as read'),
    401: swaggerErrorEnvelope('Unauthorized access'),
  },
};
