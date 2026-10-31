/**
 * Pledge voter identity (M05-P01-T02).
 *
 * Authenticated votes count by userId. Guest votes count by guestVoterId.
 * voterIpHash is not an identity and is never a fallback.
 *
 * The rate route still keys guest updates by voterIpHash and does not issue
 * `cos_guest_voter_id`. Ratings without userId and guestVoterId are not counted.
 * @@unique([submissionId, voterIpHash]) still blocks two guest rows from one IP
 * until that index is dropped. This counter still treats two persisted guest
 * tokens on one IP as two voters.
 */

export interface VoterRatingRow {
  submissionId: string;
  userId: string | null;
  guestVoterId: string | null;
  voterIpHash?: string | null;
  rating: number;
  categoryScores?: unknown;
  creatorId: string;
  submissionStatus: string;
  deleted: boolean;
}

export function isCountableRating(row: VoterRatingRow): boolean {
  if (row.deleted || row.submissionStatus !== 'APPROVED') return false;
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 10) return false;
  if (row.userId && row.userId === row.creatorId) return false;
  return Boolean(row.userId || row.guestVoterId);
}

export function voterIdentityKey(row: VoterRatingRow): string | null {
  if (!isCountableRating(row)) return null;
  if (row.userId) return `user:${row.userId}`;
  if (row.guestVoterId) return `guest:${row.guestVoterId}`;
  return null;
}

export function countDistinctVoters(
  rows: VoterRatingRow[],
  submissionId: string,
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.submissionId !== submissionId) continue;
    const key = voterIdentityKey(row);
    if (key) seen.add(key);
  }
  return seen.size;
}

export function countValidRatings(rows: VoterRatingRow[], submissionId: string): number {
  return rows.filter((row) => row.submissionId === submissionId && isCountableRating(row))
    .length;
}

export interface QuorumInput {
  distinctVoterCount: number;
  validRatingCount: number;
  requiredOverallVoters: number;
  requiredCategoryRatings: number;
  categoryScoped: boolean;
}

export interface QuorumDecision {
  distinctVoterCount: number;
  validRatingCount: number;
  requiredVoterCount: number;
  isQuorumQualified: boolean;
  quorumProgress: string;
}

export function decideQuorum(input: QuorumInput): QuorumDecision {
  const required = input.categoryScoped
    ? input.requiredCategoryRatings
    : input.requiredOverallVoters;
  const progressCount = input.categoryScoped
    ? input.validRatingCount
    : input.distinctVoterCount;
  const qualified = input.categoryScoped
    ? input.validRatingCount >= input.requiredCategoryRatings
    : input.distinctVoterCount >= input.requiredOverallVoters;
  return {
    distinctVoterCount: input.distinctVoterCount,
    validRatingCount: input.validRatingCount,
    requiredVoterCount: required,
    isQuorumQualified: qualified,
    quorumProgress: `${progressCount}/${required}`,
  };
}
