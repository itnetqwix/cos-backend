import { AccountStatus, Role } from '@prisma/client';
import {
  PaginationMeta,
  PaginationQuery,
  PaginationResult,
} from '../utils/pagination.js';

export interface SanitizedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  accountStatus: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPaginationQuery extends PaginationQuery {
  role?: Role;
}

export type { PaginationMeta, PaginationQuery, PaginationResult };
