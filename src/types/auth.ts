import { Role } from '@prisma/client';
import { SanitizedUser } from './user.js';

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
