import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { SYSTEM_CONSTANTS } from '../config/constants.js';
import { SwaggerUserSchema } from '../schemas/auth.schema.js';

const swaggerPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Register OpenAPI Specification Generator
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: SYSTEM_CONSTANTS.APP_NAME,
        description: 'Ripskis contest API. Fastify, Prisma, and PostgreSQL.',
        version: SYSTEM_CONSTANTS.API_VERSION,
        contact: {
          name: 'COS Backend Engineering Team',
          email: 'engineering@contestos.com',
        },
      },
      servers: [
        {
          url: 'http://localhost:5000',
          description: 'Local Development Server',
        },
      ],
      tags: [
        {
          name: 'Authentication',
          description: 'Creator registration, login, and the authenticated profile',
        },
        {
          name: 'Users',
          description:
            'User profile management, user listing, and administrative queries',
        },
        {
          name: 'System',
          description: 'Health checks and service metadata',
        },
        {
          name: 'Contests',
          description: 'Contest configuration and documented lifecycle transitions',
        },
        {
          name: 'Submissions',
          description:
            'Creator S3 presigned upload and submission metadata. Video bytes never enter Fastify.',
        },
        {
          name: 'Moderation',
          description:
            'Pending-review queue, approve/reject decisions, and append-only audit logs',
        },
        {
          name: 'Judging',
          description:
            'Public approved queue and optional-auth 1–5 ratings. Leaderboard ranking is not part of this tag.',
        },
      ],
      components: {
        schemas: {
          User: SwaggerUserSchema as Record<string, unknown>,
        },
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Enter your JWT Bearer token in the format: Bearer <token>',
          },
        },
      },
    },
  });

  // 2. Register Interactive Swagger UI on /docs
  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
    transformStaticCSP: (header: string) => header,
  });
};

export const swaggerPlugin = fp(swaggerPluginAsync, {
  name: 'swagger-plugin',
});
