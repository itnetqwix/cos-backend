import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { errorResponse } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

/**
 * Authentication preHandler hook to verify Bearer JWT.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Authentication required or token invalid';
    reply
      .status(HTTP_STATUS.UNAUTHORIZED)
      .send(errorResponse(`Unauthorized: ${message}`));
  }
}

/**
 * Role-based authorization guard middleware.
 */
export function requireRoles(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply
        .status(HTTP_STATUS.UNAUTHORIZED)
        .send(errorResponse('Unauthorized: Authentication required'));
      return;
    }

    if (!allowedRoles.includes(request.user.role)) {
      reply
        .status(HTTP_STATUS.FORBIDDEN)
        .send(
          errorResponse(
            `Forbidden: User role '${request.user.role}' does not have permission to access this resource`,
          ),
        );
    }
  };
}
