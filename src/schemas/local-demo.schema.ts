import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

/**
 * TEMPORARY LOCAL CLIENT DEMO MODE.
 * This route is registered only when STORAGE_PROVIDER=local-demo.
 * It is not a production contest-discovery API.
 */

const localDemoBootstrapSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['local-demo'] },
    organization: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        slug: { type: 'string' },
        status: { type: 'string' },
      },
    },
    contests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          autoAdvanceDelayMs: { type: 'integer' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          updatedAt: { type: 'string' },
          organizationId: { type: 'string', format: 'uuid' },
        },
      },
    },
  },
};

export const localDemoBootstrapSwaggerSchema: FastifySchema = {
  tags: ['Local Demo'],
  summary: 'Temporary local demo organization and contest',
  description:
    'TEMPORARY LOCAL CLIENT DEMO MODE. Public. Registered only when STORAGE_PROVIDER=local-demo. Returns ACTIVE contests for the Woofskis Demo organization, newest update first. Does not return credentials, submissions, ratings, or leaderboard rows.',
  response: {
    200: swaggerSuccessEnvelope(localDemoBootstrapSchema, 'Temporary local demo catalog'),
    404: swaggerErrorEnvelope(
      'Deployment organization was not found. Provision it before using this deployment.',
    ),
  },
};
