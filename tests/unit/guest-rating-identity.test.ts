import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, Role } from '@prisma/client';
import {
  InsertRatingData,
  LockedSubmissionScore,
  RatingRepository,
} from '../../src/repositories/rating.repository.js';
import {
  assertCanRate,
  JudgingService,
  setJudgingTransactionRunner,
} from '../../src/services/judging.service.js';
import { ForbiddenError } from '../../src/utils/response.js';
import { issueGuestVoterToken } from '../../src/services/guest-voter-cookie.js';

interface Row {
  id: string;
  submissionId: string;
  userId: string | null;
  guestVoterId: string | null;
  voterIpHash: string;
  rating: number;
}

const rows: Row[] = [];
const original = {
  lock: RatingRepository.lockSubmission,
  find: RatingRepository.findGuestVote,
  update: RatingRepository.updateGuestRating,
  insert: RatingRepository.insert,
  write: RatingRepository.writeScore,
};

function install() {
  setJudgingTransactionRunner(async (fn) => fn({} as Prisma.TransactionClient));
  RatingRepository.lockSubmission = async () =>
    ({
      id: 'video-1',
      contestId: 'contest-1',
      status: 'APPROVED',
      communityScore: 0,
      totalVotes: rows.filter((row) => row.submissionId === 'video-1').length,
      creatorId: 'creator-1',
      contestStatus: 'ACTIVE',
    }) as LockedSubmissionScore;
  RatingRepository.findGuestVote = async (submissionId, guestVoterId) => {
    const found = rows.find(
      (row) => row.submissionId === submissionId && row.guestVoterId === guestVoterId,
    );
    return found ? { id: found.id, rating: found.rating, guestVoterId: found.guestVoterId } : null;
  };
  RatingRepository.updateGuestRating = async (id, rating) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new Error('missing');
    row.rating = rating;
    return { id, rating };
  };
  RatingRepository.insert = async (data: InsertRatingData) => {
    const id = `rating-${rows.length + 1}`;
    rows.push({
      id,
      submissionId: data.submissionId,
      userId: data.userId,
      guestVoterId: data.guestVoterId,
      voterIpHash: data.voterIpHash,
      rating: data.rating,
    });
    return { id, rating: data.rating, userId: data.userId, voterFingerprint: null };
  };
  RatingRepository.writeScore = async () => undefined;
}

describe('guest rating identity', () => {
  afterEach(() => {
    rows.length = 0;
    setJudgingTransactionRunner(null);
    RatingRepository.lockSubmission = original.lock;
    RatingRepository.findGuestVote = original.find;
    RatingRepository.updateGuestRating = original.update;
    RatingRepository.insert = original.insert;
    RatingRepository.writeScore = original.write;
  });

  it('rejects a self-vote and an authenticated creator before a guest token is used', () => {
    assert.throws(
      () => assertCanRate({ id: 'creator-1', role: Role.CREATOR }, 'creator-1'),
      (error: unknown) => error instanceof ForbiddenError && error.message.includes('own submission'),
    );
    assert.throws(
      () => assertCanRate({ id: 'admin-1', role: Role.ADMIN }, 'creator-1'),
      (error: unknown) => error instanceof ForbiddenError && error.message.includes('ADMIN'),
    );
  });

  it('keeps one row per guest token across IPs and separates tokens on one IP', async () => {
    install();
    const tokenA = issueGuestVoterToken();
    const tokenB = issueGuestVoterToken();
    await JudgingService.rateSubmission({
      contestId: 'contest-1',
      videoId: 'video-1',
      rating: 8,
      voter: null,
      voterFingerprint: null,
      voterIpHash: 'ip-a',
      guestVoterId: tokenA,
    });
    await JudgingService.rateSubmission({
      contestId: 'contest-1',
      videoId: 'video-1',
      rating: 6,
      voter: null,
      voterFingerprint: null,
      voterIpHash: 'ip-b',
      guestVoterId: tokenA,
    });
    await JudgingService.rateSubmission({
      contestId: 'contest-1',
      videoId: 'video-1',
      rating: 9,
      voter: null,
      voterFingerprint: null,
      voterIpHash: 'ip-a',
      guestVoterId: tokenB,
    });
    const owned = rows.filter((row) => row.guestVoterId === tokenA);
    assert.equal(owned.length, 1);
    assert.equal(owned[0]?.rating, 6);
    assert.equal(owned[0]?.voterIpHash, 'ip-a');
    assert.equal(rows.filter((row) => row.guestVoterId === tokenB).length, 1);
    assert.equal(rows.length, 2);
  });
});
