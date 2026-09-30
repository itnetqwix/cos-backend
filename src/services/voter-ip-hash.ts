import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * One-way guest identifier for a rating.
 * HMAC-SHA256 keyed by the existing server JWT secret.
 * The raw IP is not stored and is not returned to clients.
 */
export function hashVoterIp(ip: string): string {
  const normalized = ip.trim().toLowerCase();
  return createHmac('sha256', env.JWT_SECRET).update(normalized).digest('hex');
}
