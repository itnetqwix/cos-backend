import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashVoterIp } from '../../src/services/voter-ip-hash.js';
import { contestDeletionBlockReason } from '../../src/services/contest-lifecycle.js';
import { ContestStatus } from '@prisma/client';

describe('guest vote identifier', () => {
  it('hashes the address and does not return the raw value', () => {
    const first = hashVoterIp('203.0.113.10');
    const second = hashVoterIp('203.0.113.10');
    const other = hashVoterIp('203.0.113.11');
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(first.includes('203.0.113.10'), false);
    assert.equal(first.length, 64);
  });
});

describe('contest deletion policy', () => {
  it('blocks ACTIVE and JUDGING and allows the other documented statuses', () => {
    assert.equal(contestDeletionBlockReason(ContestStatus.ACTIVE), 'Active contests cannot be deleted');
    assert.match(contestDeletionBlockReason(ContestStatus.JUDGING) ?? '', /judging/i);
    assert.equal(contestDeletionBlockReason(ContestStatus.DRAFT), null);
    assert.equal(contestDeletionBlockReason(ContestStatus.SCHEDULED), null);
    assert.equal(contestDeletionBlockReason(ContestStatus.COMPLETED), null);
    assert.equal(contestDeletionBlockReason(ContestStatus.ARCHIVED), null);
  });
});
