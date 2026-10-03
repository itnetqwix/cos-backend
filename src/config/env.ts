/**
 * Frozen COS backend environment schema (M01-P01-T02).
 *
 * `dotenv.config()` loads `.env` from process cwd, then Zod parses `process.env`.
 * Parse failure logs the Zod error and `process.exit(1)`.
 *
 * Keys currently in this schema:
 * - `PORT` — coerced number; default `SYSTEM_CONSTANTS.DEFAULT_PORT` (5000)
 * - `DATABASE_URL` — string; default `process.env.DATABASE_URL || ''` (empty string if unset)
 * - `JWT_SECRET` — string; missing key uses a hardcoded fallback in this file
 * - `NODE_ENV` — `'development' | 'production' | 'test'`; default `'development'`
 * - `LOG_LEVEL` — string; default `'info'`
 *
 * `CORS_ORIGIN` is NOT in this schema and is NOT read anywhere in the backend.
 * CORS currently hardcodes `origin: '*'` in `src/plugins/cors.ts`.
 * Allowed-origin list: NOT SPECIFIED in `/docs/source` or `/docs/knowledge`.
 *
 * None of `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, or `PORT` are required
 * at parse time (empty / missing values do not fail this schema).
 * `DATABASE_URL` is still consumed later by Prisma (`schema.prisma` `env("DATABASE_URL")`
 * and `src/config/database.ts` `datasourceUrl`).
 *
 * JWT expiry is `SYSTEM_CONSTANTS.JWT_EXPIRES_IN` (`7d`), not an env var.
 * Secret rotation / minimum entropy: NOT SPECIFIED (see later M12 JWT review).
 *
 * `.env.example` lists placeholders for these keys plus the M06 AWS/S3 keys.
 * It does not include `CORS_ORIGIN`. Do not commit real secrets.
 *
 * AWS keys (M06-P02-T01) are optional at parse time (empty-string defaults)
 * so unit tests and local boot still succeed without credentials.
 * `S3StorageAdapter` refuses to sign when region/bucket are empty.
 * There is no silent local-filesystem fallback.
 *
 * `MEDIA_CDN_BASE_URL` is optional. Empty keeps presigned S3 GET playback.
 * A value is used only for approved public queue and leaderboard URLs.
 * Set it only after `media.ripskis.com` is actually serving the media worker.
 * Do not put AWS keys in this value.
 *
 * `STORAGE_PROVIDER` is `s3`. There is no disk storage provider.
 * Missing AWS config does not fall back to local files.
 *
 * Admin bootstrap reads `RIPSKIS_ADMIN_EMAIL`, `RIPSKIS_ADMIN_PASSWORD`, and
 * `RIPSKIS_ADMIN_NAME` from the process environment in the bootstrap script.
 * Those keys are not required to boot the API.
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import { SYSTEM_CONSTANTS } from './constants.js';

dotenv.config();

const DEFAULT_NEON_DATABASE_URL = process.env.DATABASE_URL || '';

const envSchema = z.object({
  PORT: z.coerce.number().default(SYSTEM_CONSTANTS.DEFAULT_PORT),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default(DEFAULT_NEON_DATABASE_URL),
  JWT_SECRET: z.string().default('super-secret-contestos-jwt-key-2026'),
  LOG_LEVEL: z.string().default('info'),
  AWS_REGION: z.string().default(''),
  AWS_S3_BUCKET: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  STORAGE_PROVIDER: z.enum(['s3']).default('s3'),
  /**
   * Public media hostname, for example `https://media.ripskis.com`.
   * Empty means approved playback still uses a presigned S3 GET.
   * Restricted creator, moderation, and admin playback always presigns.
   */
  MEDIA_CDN_BASE_URL: z.string().default(''),
  /**
   * Trusted reverse-proxy hops for Fastify `request.ip`.
   * 0 keeps the socket address (local and tests).
   * Production defaults to 1 so the immediate proxy hop is trusted.
   * A client-supplied custom header is not read directly.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = {
  ...parsedEnv.data,
  TRUST_PROXY_HOPS:
    parsedEnv.data.TRUST_PROXY_HOPS ?? (parsedEnv.data.NODE_ENV === 'production' ? 1 : 0),
};

if (
  env.NODE_ENV === 'production' &&
  env.JWT_SECRET === 'super-secret-contestos-jwt-key-2026'
) {
  console.error(
    'JWT_SECRET must be set to a deployment secret when NODE_ENV=production.',
  );
  process.exit(1);
}

export type Environment = z.infer<typeof envSchema>;
