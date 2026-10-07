import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCommunityScore,
  computeUpdatedCommunityScore,
} from '../../src/services/community-score.js';

/**
 * BR-VOTE-03 fixtures (M08-P02-T02 / M08-P05-T01).
 * NewScore = round((PrevScore * PrevVotes + Rating) / (PrevVotes + 1), 1)
 * Delta = round(NewScore - PrevScore, 1)
 */

describe('community score formula', () => {
  it('first rating on a zero score becomes that rating', () => {
    const score = computeCommunityScore(0, 0, 5);
    assert.deepEqual(score, {
      previousScore: 0,
      newScore: 5,
      delta: 5,
      totalVotes: 1,
    });
  });

  it('averages a second rating and rounds to 1 decimal', () => {
    const score = computeCommunityScore(4, 1, 5);
    assert.equal(score.newScore, 4.5);
    assert.equal(score.delta, 0.5);
    assert.equal(score.totalVotes, 2);
  });

  it('rounds 4.7 with 2 votes and a rating of 3 down to 4.1', () => {
    const score = computeCommunityScore(4.7, 2, 3);
    assert.equal(score.previousScore, 4.7);
    assert.equal(score.newScore, 4.1);
    assert.equal(score.delta, -0.6);
    assert.equal(score.totalVotes, 3);
  });

  it('rounds a positive tenth boundary without float drift', () => {
    const score = computeCommunityScore(4.6, 9, 5);
    assert.equal(score.newScore, 4.6);
    assert.equal(score.delta, 0);
    assert.equal(score.totalVotes, 10);
  });

  it('uses the stored rounded score, not a fresh average of raw ratings', () => {
    const afterThree = computeCommunityScore(3.7, 3, 1);
    assert.equal(afterThree.newScore, 3);
    assert.equal(afterThree.delta, -0.7);
    assert.equal(afterThree.totalVotes, 4);
  });

  it('replaces one rating without adding a vote', () => {
    const score = computeUpdatedCommunityScore(8, 1, 8, 9);
    assert.equal(score.newScore, 9);
    assert.equal(score.delta, 1);
    assert.equal(score.totalVotes, 1);
    const shared = computeUpdatedCommunityScore(8, 2, 8, 10);
    assert.equal(shared.newScore, 9);
    assert.equal(shared.totalVotes, 2);
  });
});
