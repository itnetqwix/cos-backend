import { Role } from '@prisma/client';
import {
  PaginationMeta,
  PaginationQuery,
  PaginationResult,
} from '../utils/pagination.js';

/**
 * Auth/API user payload. `handle` and `avatarUrl` are not included:
 * domain-model PLANNED fields; persistence is NOT SPECIFIED (M02-P01-T05).
 */
export interface SanitizedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SanitizedOrganization {
  id: string;
  name: string;
  slug: string;
  branding: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithOrganization extends SanitizedUser {
  organization: SanitizedOrganization | null;
}

export interface UserPaginationQuery extends PaginationQuery {
  role?: Role;
}

export type { PaginationMeta, PaginationQuery, PaginationResult };
