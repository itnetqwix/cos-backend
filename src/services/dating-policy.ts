import { ValidationError } from '../utils/response.js';
import { DATING_POLICY_REJECTION } from './dating-constants.js';

/**
 * Blocks commercial drug-sale language. Cannabis lifestyle words
 * (strain names, "sesh", "edible") are allowed. This is not a marketplace.
 *
 * "menu" and "plug" are included because the product scope names them.
 * They can reject ordinary sentences. That false-positive cost is documented.
 */
const PROHIBITED_PATTERNS: RegExp[] = [
  /\bfor sale\b/i,
  /\bselling\b/i,
  /\bdm for menu\b/i,
  /\bdrop[\s-]?off\b/i,
  /\bshipping available\b/i,
  /\bcheap zips?\b/i,
  /\bexotics on deck\b/i,
  /\bpack landed\b/i,
  /tele\s*@/i,
  /\btelegram\b/i,
  /\bcash\s*app\b/i,
  /\bvenmo\b/i,
  /\bsignal\s*:/i,
  /\bsnap\s*:/i,
  /\bwickr\b/i,
  /\bhit my line\b/i,
  /\bhalf zip\b/i,
  /\bqps\b/i,
  /\bps for\b/i,
  /carts for\s*\$/i,
  /\bbulk packs\b/i,
  /\bgram for\s*\$/i,
  /\bplug\b/i,
  /\bmenu\b/i,
];

export function findProhibitedTerm(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const pattern of PROHIBITED_PATTERNS) {
    const match = pattern.exec(value);
    if (match) return match[0];
  }
  return null;
}

export function assertDatingTextAllowed(value: string | null | undefined): void {
  if (findProhibitedTerm(value)) {
    throw new ValidationError(DATING_POLICY_REJECTION);
  }
}

export function assertDatingTextsAllowed(values: Array<string | null | undefined>): void {
  for (const value of values) assertDatingTextAllowed(value);
}
