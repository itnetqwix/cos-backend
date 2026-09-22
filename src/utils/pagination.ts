import { SYSTEM_CONSTANTS } from '../config/constants.js';

export interface PaginationQuery {
  page?: number | string;
  limit?: number | string;
  search?: string;
  [key: string]: unknown;
}

export interface PaginationMeta {
  totalCount: number;
  totalPages: number;
  currentPage: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginationResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * Extract and sanitize pagination parameters from raw request query.
 */
export function parsePaginationParams(query?: Partial<PaginationQuery>): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Number(query?.page) || SYSTEM_CONSTANTS.DEFAULT_PAGE);
  const rawLimit = Number(query?.limit) || SYSTEM_CONSTANTS.DEFAULT_PAGE_LIMIT;
  const limit = Math.min(Math.max(1, rawLimit), SYSTEM_CONSTANTS.MAX_PAGE_LIMIT);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Construct standard pagination metadata.
 */
export function buildPaginationMeta(
  totalCount: number,
  page: number,
  limit: number,
): PaginationMeta {
  const totalPages = Math.ceil(totalCount / limit) || 1;

  return {
    totalCount,
    totalPages,
    currentPage: page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * Build paginated data container.
 */
export function buildPaginatedResult<T>(
  items: T[],
  totalCount: number,
  page: number,
  limit: number,
): PaginationResult<T> {
  return {
    items,
    pagination: buildPaginationMeta(totalCount, page, limit),
  };
}
