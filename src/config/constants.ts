export const SYSTEM_CONSTANTS = {
  APP_NAME: 'Contest Operating System Backend',
  API_VERSION: '1.0.0',
  DEFAULT_PORT: 5000,
  API_PREFIX: '/api/v1',
  BCRYPT_SALT_ROUNDS: 10,
  JWT_EXPIRES_IN: '7d',
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_LIMIT: 20,
  MAX_PAGE_LIMIT: 100,
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Basic request ceilings (M12-P01).
 *
 * Numeric thresholds are NOT SPECIFIED in `/docs/source`. These values are
 * engineering defaults, not business rules. Automated fraud heuristics remain
 * NOT SPECIFIED. Redis is not used; the counter is in-memory per process.
 *
 * Each of these routes keeps its own per-IP counter (the plugin store is
 * per route):
 * `POST /auth/login`, `POST /auth/register/creator`.
 * `GET /auth/me` is not limited. The hook is `onRequest`, so a blocked call
 * does not reach bcrypt.
 *
 * Rating POST is a separate per-IP bucket (M12-P01-T02). Auth on that route
 * is optional, so the key is the connection IP, not a user id.
 *
 * `X-Forwarded-For` is not trusted. Fastify `trustProxy` is unchanged.
 * Proxy IP identification is NOT SPECIFIED.
 */
export const RATE_LIMIT_DEFAULTS = {
  AUTH_MAX: 10,
  AUTH_TIME_WINDOW_MS: 15 * 60 * 1000,
  RATING_MAX: 60,
  RATING_TIME_WINDOW_MS: 60 * 1000,
} as const;

export const ROLES = {
  ADMIN: 'ADMIN',
  CREATOR: 'CREATOR',
} as const;

export type SystemRole = (typeof ROLES)[keyof typeof ROLES];

/**
 * Locked video constraints (BR-VID-03 / M06).
 * Formats, 100MB, and 60s are documented. Bitrate, resolution, codec,
 * and transcoding are NOT SPECIFIED and are not enforced here.
 *
 * Presign expiry is an engineering default (source does not name a TTL).
 */
export const VIDEO_CONSTRAINTS = {
  ALLOWED_CONTENT_TYPES: ['video/mp4', 'video/webm'] as const,
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  MIN_DURATION_SECONDS: 1,
  MAX_DURATION_SECONDS: 60,
  PRESIGN_EXPIRES_SECONDS: 900,
} as const;

export type AllowedVideoContentType =
  (typeof VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES)[number];
