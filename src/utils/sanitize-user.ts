/**
 * Strip `passwordHash` before a user object leaves the service layer.
 *
 * M12-P02-T01. Repository selects already omit the hash on public reads.
 * This function is the named guarantee for any object that still carries it
 * (login loads the hash in order to compare it).
 */
export function sanitizeUser<T extends object>(user: T): Omit<T, 'passwordHash'> {
  const safe = { ...user } as Omit<T, 'passwordHash'> & { passwordHash?: unknown };
  delete safe.passwordHash;
  return safe;
}
