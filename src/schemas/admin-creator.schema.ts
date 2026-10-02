import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

export const creatorIdParamSchema = z.object({
  id: z.string().uuid('Creator ID must be a valid UUID format'),
});

export const adminSubmissionIdParamSchema = z.object({
  id: z.string().uuid('Submission ID must be a valid UUID format'),
});

const creatorListItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
    createdAt: { type: 'string' },
    submissionCount: { type: 'integer' },
  },
};

export const listCreatorsSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'List registered creators',
  description:
    'ADMIN only. Returns creator name, email, role, createdAt, and submission count. Passwords are not included.',
  security: [{ bearerAuth: [] }],
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          totalCreators: { type: 'integer' },
          creators: { type: 'array', items: creatorListItemSchema },
        },
      },
      'Creators retrieved successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
  },
};

export const getCreatorSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Get a creator and their submissions',
  description:
    'ADMIN only. Includes submission status, contest, createdAt, and a presigned playback URL. Does not expose storage credentials.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope({ type: 'object' }, 'Creator retrieved successfully'),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Creator not found'),
  },
};

export const deleteCreatorSubmissionSwaggerSchema: FastifySchema = {
  tags: ['Admin'],
  summary: 'Delete a creator submission',
  description:
    'ADMIN only. Deletes the submission row. Ratings and comments cascade. The creator account, contest, and other submissions are kept. The S3 object is not deleted.',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: swaggerSuccessEnvelope(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          deleted: { type: 'boolean' },
          mediaObjectRetained: { type: 'boolean' },
        },
      },
      'Submission deleted successfully',
    ),
    401: swaggerErrorEnvelope('Unauthorized'),
    403: swaggerErrorEnvelope('Forbidden'),
    404: swaggerErrorEnvelope('Submission not found'),
  },
};
