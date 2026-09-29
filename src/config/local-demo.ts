/**
 * Temporary local client demo identifiers.
 *
 * These lookup keys are not production business rules. Seed and the
 * local-demo catalog use them so a second run updates the same rows.
 * Credentials stay in `prisma/seed.ts` and `docs/LOCAL-DEMO-MODE.md`.
 */

export const LOCAL_DEMO = {
  organizationName: 'Woofskis Demo',
  organizationSlug: 'woofskis-demo',
  contestTitle: 'Woofskis Demo Contest',
  adminEmail: 'admin@woofskis-demo.com',
  creatorEmail: 'creator@woofskis-demo.com',
  autoAdvanceDelayMs: 1800,
} as const;
