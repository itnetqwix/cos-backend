import bcrypt from 'bcrypt';
import { SYSTEM_CONSTANTS } from '../config/constants.js';

/**
 * Hash plain text password using bcrypt with standard salt rounds.
 */
export async function hashPassword(
  password: string,
  saltRounds: number = SYSTEM_CONSTANTS.BCRYPT_SALT_ROUNDS,
): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

/**
 * Compare plain text password against hashed password.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
