import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { COMMENT_BODY_MAX } from '../services/comment.service.js';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const commentSubmissionParamSchema = z.object({
  id: z.string().uuid('Submission ID must be a valid UUID format'),
});

export const createCommentBodySchema = z.object({
  body: z.string(),
});

export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;

const commentViewSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    submissionId: { type: 'string' },
    body: { type: 'string' },
    createdAt: { type: 'string' },
    author: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
};

export const listCommentsSwaggerSchema: FastifySchema = {
  tags: ['Comments'],
  summary: 'List comments for a submission',
  description:
    'Public. Comments belong to the submission, not the contest. Newest first. Guest authorship is NOT SPECIFIED; this route only reads.',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: swaggerSuccessEnvelope(
      { type: 'array', items: commentViewSchema },
      'Comments retrieved successfully',
    ),
    404: swaggerErrorEnvelope('Submission not found'),
  },
};

export const createCommentSwaggerSchema: FastifySchema = {
  tags: ['Comments'],
  summary: 'Add a comment to a submission',
  description: `Authenticated users only. Guest comment authorship is NOT SPECIFIED and is not accepted. Body is trimmed, must be non-empty, and cannot exceed ${COMMENT_BODY_MAX} characters. The comment is stored on the submission id in the path.`,
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string' },
    },
  },
  response: {
    201: swaggerSuccessEnvelope(commentViewSchema, 'Comment created'),
    400: swaggerErrorEnvelope('Comment cannot be empty'),
    401: swaggerErrorEnvelope('Unauthorized'),
    404: swaggerErrorEnvelope('Submission not found'),
  },
};
