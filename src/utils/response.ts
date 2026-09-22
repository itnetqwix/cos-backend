import { FastifyReply } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { buildPaginatedResult } from './pagination.js';

/**
 * Frozen COS HTTP response envelope (M01-P01-T01).
 *
 * Every JSON body returned by `sendSuccess`, `sendError`, `sendPaginated`,
 * `successResponse`, `errorResponse`, and `paginatedResponse` MUST contain
 * exactly these four top-level fields:
 *
 * ```
 * { success: boolean, message: string, data: T | null, errors: unknown | null }
 * ```
 *
 * Success (`sendSuccess` / `successResponse` / `sendPaginated`):
 * - `success` is `true`
 * - `data` holds the payload (`T`; may be `null` if the caller passes `null`)
 * - `errors` is always `null`
 *
 * Error (`sendError` / `errorResponse`):
 * - `success` is `false`
 * - `data` is always `null`
 * - `errors` is `null` or a caller-supplied details value
 *
 * Not part of this envelope (do not add without a roadmap amendment):
 * - top-level `timestamp` — NOT SPECIFIED at envelope level
 *   (`timestamp` may appear inside `data`, e.g. health payload)
 * - nested `{ error: { code, message } }` — frontend prototype shape only
 * - top-level `meta` — pagination lives under `data.pagination`
 *
 * `errors` item schema is NOT SPECIFIED beyond `unknown | null`.
 * Current callers typically pass `null` or `{ field, message }[]`.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown | null;
}

// ----------------------
// Custom Application Errors
// ----------------------

export class AppError extends Error {
  public statusCode: number;
  public errors: unknown | null;

  constructor(
    message: string,
    statusCode: number = HTTP_STATUS.BAD_REQUEST,
    errors: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', errors: unknown = null) {
    super(message, HTTP_STATUS.NOT_FOUND, errors);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', errors: unknown = null) {
    super(message, HTTP_STATUS.CONFLICT, errors);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access', errors: unknown = null) {
    super(message, HTTP_STATUS.UNAUTHORIZED, errors);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden access', errors: unknown = null) {
    super(message, HTTP_STATUS.FORBIDDEN, errors);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors: unknown = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, errors);
    this.name = 'ValidationError';
  }
}

// ----------------------
// Response Factories
// ----------------------

/**
 * Build a success envelope. Does not set HTTP status — use `sendSuccess` for replies.
 */
export function successResponse<T>(
  data: T,
  message = 'Operation completed successfully',
): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
    errors: null,
  };
}

/**
 * Build an error envelope. Does not set HTTP status — use `sendError` for replies.
 *
 * Default message here is `'An unexpected error occurred'`. `sendError` uses a
 * different default (`'An error occurred'`) when called without a message.
 */
export function errorResponse(
  message = 'An unexpected error occurred',
  errors: unknown = null,
): ApiResponse<null> {
  return {
    success: false,
    message,
    data: null,
    errors,
  };
}

/**
 * Build a success envelope whose `data` is `{ items, pagination }`.
 */
export function paginatedResponse<T>(
  items: T[],
  totalCount: number,
  page: number,
  limit: number,
  message = 'Records retrieved successfully',
): ApiResponse<{
  items: T[];
  pagination: ReturnType<typeof import('./pagination.js').buildPaginationMeta>;
}> {
  const result = buildPaginatedResult(items, totalCount, page, limit);
  return {
    success: true,
    message,
    data: result,
    errors: null,
  };
}

// ----------------------
// Fastify Reply Helpers
// ----------------------

/**
 * Reply helper for successful operations.
 *
 * Signature: `sendSuccess(reply, data, message?, statusCode?)`
 * Defaults: message `'Operation completed successfully'`, status `200`.
 */
export function sendSuccess<T>(
  reply: FastifyReply,
  data: T,
  message = 'Operation completed successfully',
  statusCode: number = HTTP_STATUS.OK,
): FastifyReply {
  return reply.status(statusCode).send(successResponse(data, message));
}

/**
 * Reply helper for explicit error responses.
 *
 * Signature: `sendError(reply, message?, statusCode?, errors?)`
 * Defaults: message `'An error occurred'`, status `400`, errors `null`.
 *
 * Controllers currently throw `AppError` subclasses; `globalErrorHandler`
 * formats those via `errorResponse`. Prefer `sendError` when a route replies
 * with an error without throwing.
 */
export function sendError(
  reply: FastifyReply,
  message = 'An error occurred',
  statusCode: number = HTTP_STATUS.BAD_REQUEST,
  errors: unknown = null,
): FastifyReply {
  return reply.status(statusCode).send(errorResponse(message, errors));
}

/**
 * Reply helper for paginated lists. Same envelope as `sendSuccess`;
 * `data` is `{ items, pagination }`. Default status `200`.
 */
export function sendPaginated<T>(
  reply: FastifyReply,
  items: T[],
  totalCount: number,
  page: number,
  limit: number,
  message = 'Records retrieved successfully',
  statusCode: number = HTTP_STATUS.OK,
): FastifyReply {
  return reply
    .status(statusCode)
    .send(paginatedResponse(items, totalCount, page, limit, message));
}
