import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { sendError } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

/**
 * Authentication preHandler (M03-P01-T01).
 *
 * Verifies Bearer JWT via `@fastify/jwt` `request.jwtVerify()`.
 * On success, Fastify attaches decoded claims to `request.user`.
 * Typed claims (`JWTPayload`) are exactly `{ id, email, role, organizationId }`
 * (frozen M02-P01). `role` is Prisma `Role`.
 *
 * Missing/invalid token → HTTP 401 frozen envelope
 * `{ success, message, data: null, errors }`.
 * This hook does **not** check roles — use `authorizeRoles` after it.
 *
 * `fastify.authenticate` (jwt plugin decorate) is this function.
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
    sendError(reply, `Unauthorized: ${message}`, HTTP_STATUS.UNAUTHORIZED);
  }
}

/**
 * Role-based authorization guard (M03-P01-T01).
 *
 * Higher-order `onRequest` hook. Intended usage:
 * `onRequest: [fastify.authenticate, authorizeRoles(Role.SUPER_ADMIN)]`
 *
 * Allowed values are the Prisma `Role` enum:
 * `SUPER_ADMIN`, `BRAND_ADMIN`, `CREATOR`, `VIEWER`.
 * Fine-grained permission table beyond this enum: **NOT SPECIFIED**.
 *
 * No `request.user` after authenticate → 401.
 * Authenticated but role not in `allowedRoles` → 403 frozen envelope.
 *
 * Frontend prototype aliases (`ORGANIZATION_ADMIN`, `PLATFORM_ADMIN`) are
 * not accepted here; JWT/Prisma emit backend enum names only.
 */
export function authorizeRoles(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      sendError(reply, 'Unauthorized: Authentication required', HTTP_STATUS.UNAUTHORIZED);
      return;
    }

    if (!allowedRoles.includes(request.user.role)) {
      // M03-P01-T03: 403 uses sendError → frozen envelope
      // `{ success: false, message, data: null, errors: null }`.
      sendError(
        reply,
        `Forbidden: User role '${request.user.role}' does not have permission to access this resource`,
        HTTP_STATUS.FORBIDDEN,
        null,
      );
    }
  };
}

/** Pre-M03 name. Canonical export is `authorizeRoles`. */
export const requireRoles = authorizeRoles;
