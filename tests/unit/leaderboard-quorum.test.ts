import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countDistinctVoters,
  countValidRatings,
  decideQuorum,
  type VoterRatingRow,
} from '../../src/services/voter-quorum.js';

const submissionId = 'sub-1';

function row(partial: Partial<VoterRatingRow>): VoterRatingRow {
  return {
    submissionId,
    userId: null,
    guestVoterId: null,
    voterIpHash: 'ip-a',
    rating: 8,
    creatorId: 'creator-1',
    submissionStatus: 'APPROVED',
    deleted: false,
    ...partial,
  };
}

describe('pledge voter quorum', () => {
  it('counts users and guest tokens, and ignores IP identity', () => {
    const rows = [
      row({ userId: 'user-1', voterIpHash: 'ip-a' }),
      row({ userId: 'user-1', voterIpHash: 'ip-b' }),
      row({ guestVoterId: 'guest-1', voterIpHash: 'ip-a' }),
      row({ guestVoterId: 'guest-1', voterIpHash: 'ip-c' }),
      row({ guestVoterId: 'guest-2', voterIpHash: 'ip-a' }),
      row({ voterIpHash: 'ip-d' }),
      row({ userId: null, guestVoterId: null, voterIpHash: null }),
      row({ userId: 'creator-1', voterIpHash: 'ip-e' }),
      row({ userId: 'user-2', rating: 0 }),
      row({ userId: 'user-3', submissionStatus: 'FLAGGED' }),
      row({ userId: 'user-4', deleted: true }),
    ];
    assert.equal(countDistinctVoters(rows, submissionId), 3);
    assert.equal(countValidRatings(rows, submissionId), 5);
  });

  it('keeps the overall and category thresholds separate', () => {
    const overall = decideQuorum({
      distinctVoterCount: 7,
      validRatingCount: 7,
      requiredOverallVoters: 10,
      requiredCategoryRatings: 5,
      categoryScoped: false,
    });
    assert.equal(overall.isQuorumQualified, false);
    assert.equal(overall.quorumProgress, '7/10');
    assert.equal(overall.requiredVoterCount, 10);

    const category = decideQuorum({
      distinctVoterCount: 5,
      validRatingCount: 5,
      requiredOverallVoters: 10,
      requiredCategoryRatings: 5,
      categoryScoped: true,
    });
    assert.equal(category.isQuorumQualified, true);
    assert.equal(category.quorumProgress, '5/5');
    assert.equal(category.requiredVoterCount, 5);

    const shortCategory = decideQuorum({
      distinctVoterCount: 4,
      validRatingCount: 4,
      requiredOverallVoters: 10,
      requiredCategoryRatings: 5,
      categoryScoped: true,
    });
    assert.equal(shortCategory.isQuorumQualified, false);
    assert.equal(shortCategory.quorumProgress, '4/5');
  });
});
