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
 * `STORAGE_PROVIDER` is `s3` (default, production) or `local-demo`
 * (TEMPORARY LOCAL CLIENT DEMO MODE). `s3` never selects disk storage.
 * `DEMO_MEDIA_PORT` is the standalone demo media port (default 5055).
 * It is unused when the provider is `s3`.
 *
 * `DEPLOYMENT_ORGANIZATION_SLUG` is the one organization for this deployment.
 * It is a slug, not a UUID. The default matches the Woofskis demo seed.
 * Another company's deployment sets its own slug and database.
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import { LOCAL_DEMO } from './local-demo.js';
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
  STORAGE_PROVIDER: z.enum(['s3', 'local-demo']).default('s3'),
  DEMO_MEDIA_PORT: z.coerce.number().int().positive().default(5055),
  DEPLOYMENT_ORGANIZATION_SLUG: z
    .string()
    .trim()
    .min(1)
    .default(LOCAL_DEMO.organizationSlug),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
export type Environment = z.infer<typeof envSchema>;
