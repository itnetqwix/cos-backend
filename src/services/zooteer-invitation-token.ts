import crypto from 'node:crypto';

/** 32 random bytes. The raw value is returned once and never stored. */
export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function invitationTokenHashesMatch(
  storedHex: string,
  computedHex: string,
): boolean {
  const left = Buffer.from(storedHex);
  const right = Buffer.from(computedHex);
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
