import { Role } from '@prisma/client';
import { SanitizedUser } from './user.js';

/**
 * Access-token claims. Product identity is `{ id, email, role }`.
 * `role` is Prisma `Role` (`ADMIN`, `CREATOR`).
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
}

export interface AuthResponseData {
  user: SanitizedUser;
  token: string;
}

export interface RegisterCreatorDTO {
  email: string;
  password: string;
  name: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}
