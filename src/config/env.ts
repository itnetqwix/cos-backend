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
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
export type Environment = z.infer<typeof envSchema>;
