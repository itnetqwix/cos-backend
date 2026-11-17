import { randomInt } from 'node:crypto';

/** Unambiguous alphabet. 8 characters, stable for the life of the room. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return null;
  return code;
}
