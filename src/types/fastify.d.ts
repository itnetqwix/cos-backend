import { PrismaClient } from '@prisma/client';
import { JWTPayload } from './auth.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    user: JWTPayload;
  }
}

export {};
