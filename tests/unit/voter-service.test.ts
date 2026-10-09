import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { SubmissionStatus } from '@prisma/client';
import { RatingRepository } from '../../src/repositories/rating.repository.js';
import { SubmissionRepository } from '../../src/repositories/submission.repository.js';
import { VoterService } from '../../src/services/voter.service.js';

const VIDEO = '22222222-2222-4222-8222-222222222221';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-0000000000bb';

const originals = {
  findById: SubmissionRepository.findById,
  listForSubmission: RatingRepository.listForSubmission,
};

after(() => {
  SubmissionRepository.findById = originals.findById;
  RatingRepository.listForSubmission = originals.listForSubmission;
});

describe('submission voters', { concurrency: false }, () => {
  it('returns only ratings for the approved submission and hides private fields', async () => {
    SubmissionRepository.findById = async (id: string) =>
      id === VIDEO ? ({ id, status: SubmissionStatus.APPROVED } as never) : null;
    RatingRepository.listForSubmission = async (submissionId: string) => {
      assert.equal(submissionId, VIDEO);
      return {
        total: 2,
        rows: [
          {
            id: 'rating-1',
            rating: 8,
            createdAt: new Date('2026-10-02T00:00:00.000Z'),
            user: { id: USER, name: 'Ada', avatarObjectKey: null },
          },
          {
            id: 'rating-2',
            rating: 6,
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            user: null,
          },
        ],
      };
    };

    const page = await VoterService.listForSubmission(VIDEO, 1, 20);
    assert.equal(page.total, 2);
    assert.equal(page.items[0].name, 'Ada');
    assert.equal(page.items[0].rating, 8);
    assert.equal(page.items[1].name, null);
    const packed = JSON.stringify(page);
    assert.equal(packed.includes('email'), false);
    assert.equal(packed.includes('voterIpHash'), false);
    assert.equal(packed.includes('avatarObjectKey'), false);

    await assert.rejects(() => VoterService.listForSubmission(OTHER, 1, 20), /Submission not found/);
  });

  it('does not list voters for a submission that is not approved', async () => {
    SubmissionRepository.findById = async () =>
      ({ id: VIDEO, status: SubmissionStatus.PENDING_REVIEW }) as never;
    let listed = false;
    RatingRepository.listForSubmission = async () => {
      listed = true;
      return { total: 0, rows: [] };
    };
    await assert.rejects(() => VoterService.listForSubmission(VIDEO, 1, 20), /Submission not found/);
    assert.equal(listed, false);
  });
});