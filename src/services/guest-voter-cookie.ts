import { randomBytes } from 'node:crypto';

/**
 * Server-issued guest voter cookie (M05 gap closure).
 * The token is opaque random bytes. It is not an IP, fingerprint, or user id.
 * The raw token is not written to logs or JSON bodies.
 *
 * No Domain attribute: the cookie is host-only, so the browser sends it only
 * to the API host that set it. SameSite=Lax for a same-site frontend/API pair
 * (www.ripskis.com and api.ripskis.com, or localhost ports). SameSite=None
 * and Secure when a configured frontend origin is cross-site. The token is
 * not readable from JavaScript (HttpOnly).
 */

export type GuestCookieSameSite = 'lax' | 'none';

export const GUEST_VOTER_COOKIE = 'cos_guest_voter_id';
const TOKEN_BYTES = 32;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/** 32 bytes, base64url, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function issueGuestVoterToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function isGuestVoterToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function readGuestVoterCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== GUEST_VOTER_COOKIE) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      const value = decodeURIComponent(raw);
      return isGuestVoterToken(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveGuestVoterToken(cookieHeader: string | undefined): {
  token: string;
  reused: boolean;
} {
  const existing = readGuestVoterCookie(cookieHeader);
  if (existing) return { token: existing, reused: true };
  return { token: issueGuestVoterToken(), reused: false };
}

export function guestVoterCookieOptions(input: {
  nodeEnv: string;
  sameSite: GuestCookieSameSite;
}): { secure: boolean; sameSite: GuestCookieSameSite } {
  return {
    sameSite: input.sameSite,
    secure: input.nodeEnv === 'production' || input.sameSite === 'none',
  };
}

export function guestVoterSetCookie(
  token: string,
  options: { secure: boolean; sameSite: GuestCookieSameSite },
): string {
  const sameSite = options.sameSite === 'none' ? 'None' : 'Lax';
  const secure = options.secure || options.sameSite === 'none';
  const parts = [
    `${GUEST_VOTER_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
