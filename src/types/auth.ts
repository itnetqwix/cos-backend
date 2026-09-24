import { Role } from '@prisma/client';
import { SanitizedUser } from './user.js';

/**
 * Access-token claims issued by AuthService (M02-P01) and verified by
 * `fastify.authenticate` / `authenticate` (M03-P01-T01).
 * Documented set: `id`, `email`, `role`, `organizationId`.
 * `role` is Prisma `Role` (`SUPER_ADMIN`, `BRAND_ADMIN`, `CREATOR`, `VIEWER`).
 * Refresh-token claims, extra profile fields (`handle`, `avatarUrl`),
 * cookie transport, and frontend prototype aliases (`ORGANIZATION_ADMIN`,
 * `PLATFORM_ADMIN`) are NOT SPECIFIED on the JWT.
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

export interface AuthTokens {
  accessToken: string;
}

export interface AuthResponseData {
  user: SanitizedUser;
  token: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    branding?: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
}

/** Matches `registerCreatorSchema`. No `handle` (dropped M02-P01-T06). */
export interface RegisterCreatorDTO {
  email: string;
  password: string;
  name: string;
}

export interface RegisterBrandDTO {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  slug: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}
