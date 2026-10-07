/**
 * Community consensus (BR-VOTE-03 / M08-P02-T02).
 *
 * NewScore = round((PreviousScore * PreviousVotes + Rating) / (PreviousVotes + 1), 1)
 * Delta = round(NewScore - PreviousScore, 1)
 *
 * Scores are kept in tenths so the documented 1-decimal round does not depend
 * on binary float error. This is the running rounded score, not a fresh
 * average of raw ratings and not an M09 rank.
 */

export interface CommunityScoreResult {
  previousScore: number;
  newScore: number;
  delta: number;
  totalVotes: number;
}

function toTenths(score: number): number {
  return Math.round(score * 10);
}

export function computeCommunityScore(
  previousScore: number,
  previousVotes: number,
  rating: number,
): CommunityScoreResult {
  const previousTenths = toTenths(previousScore);
  const numerator = previousTenths * previousVotes + rating * 10;
  const newTenths = Math.round(numerator / (previousVotes + 1));
  const newScore = newTenths / 10;
  const delta = (newTenths - previousTenths) / 10;

  return {
    previousScore: previousTenths / 10,
    newScore,
    delta,
    totalVotes: previousVotes + 1,
  };
}

/**
 * Replace one viewer's rating without adding a vote.
 * NewScore = round((PreviousScore * totalVotes - previousRating + rating) / totalVotes, 1)
 */
export function computeUpdatedCommunityScore(
  previousScore: number,
  totalVotes: number,
  previousRating: number,
  rating: number,
): CommunityScoreResult {
  const votes = totalVotes > 0 ? totalVotes : 1;
  const previousTenths = toTenths(previousScore);
  const numerator = previousTenths * votes - toTenths(previousRating) + toTenths(rating);
  const newTenths = Math.round(numerator / votes);
  const newScore = newTenths / 10;

  return {
    previousScore: previousTenths / 10,
    newScore,
    delta: (newTenths - previousTenths) / 10,
    totalVotes: votes,
  };
}
