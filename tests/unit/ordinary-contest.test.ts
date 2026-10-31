import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOrdinaryContest } from '../../src/services/contest.service.js';

describe('ordinary contest list', () => {
  it('keeps series cycles out of All Contests', () => {
    assert.equal(isOrdinaryContest({ seriesSlug: null }), true);
    assert.equal(isOrdinaryContest({ seriesSlug: 'pledge' }), false);
    assert.equal(isOrdinaryContest({ seriesSlug: 'other-series' }), false);
  });
});
