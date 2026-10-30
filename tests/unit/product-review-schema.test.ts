import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_CONSTRAINTS } from '../../src/config/constants.js';
import {
  REVIEW_TEXT_LIMITS,
  createReviewDraftSchema,
  presignReviewSchema,
  requestReviewChangesSchema,
  reviewListQuerySchema,
  submitReviewSchema,
  updateReviewDraftSchema,
} from '../../src/schemas/product-review.schema.js';

const PRODUCT = '44444444-4444-4444-8444-444444444444';
const TYPE = '55555555-5555-4555-8555-555555555555';
const CATEGORY = '66666666-6666-4666-8666-666666666666';

describe('product review schemas', () => {
  it('accepts a presign body inside the existing video constraints', () => {
    const parsed = presignReviewSchema.parse({
      contentType: 'video/mp4',
      fileSizeBytes: 1024,
      durationSeconds: 12,
    });
    assert.equal(parsed.contentType, 'video/mp4');
    assert.throws(() =>
      presignReviewSchema.parse({
        contentType: 'video/avi',
        fileSizeBytes: 1024,
        durationSeconds: 12,
      }),
    );
    assert.throws(() =>
      presignReviewSchema.parse({
        contentType: 'video/mp4',
        fileSizeBytes: VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES + 1,
        durationSeconds: 12,
      }),
    );
  });

  it('rejects client overall scores, weight snapshots, and out-of-range category scores', () => {
    assert.throws(() =>
      createReviewDraftSchema.parse({
        productId: PRODUCT,
        videoObjectKey: 'reviews/x/y.mp4',
        durationSeconds: 10,
        overallScore: 9,
      }),
    );
    assert.throws(() =>
      createReviewDraftSchema.parse({
        productId: PRODUCT,
        videoObjectKey: 'reviews/x/y.mp4',
        durationSeconds: 10,
        weightsSnapshot: [{ categoryId: CATEGORY, weight: 4 }],
      }),
    );
    const valid = createReviewDraftSchema.parse({
      productId: PRODUCT,
      productTypeId: TYPE,
      videoObjectKey: 'reviews/x/y.mp4',
      durationSeconds: 10,
      city: 'Las Vegas',
      categoryScores: [{ categoryId: CATEGORY, score: 8 }],
    });
    assert.equal(valid.categoryScores?.[0].score, 8);
    assert.equal('overallScore' in valid, false);
    for (const score of [0, 11, 1.5]) {
      assert.throws(() =>
        createReviewDraftSchema.parse({
          productId: PRODUCT,
          videoObjectKey: 'reviews/x/y.mp4',
          durationSeconds: 10,
          categoryScores: [{ categoryId: CATEGORY, score }],
        }),
      );
    }
  });

  it('limits text, pagination, and unknown filters including strain', () => {
    assert.throws(() =>
      updateReviewDraftSchema.parse({
        reviewNotes: 'x'.repeat(REVIEW_TEXT_LIMITS.notes + 1),
      }),
    );
    assert.throws(() => updateReviewDraftSchema.parse({}));
    assert.throws(() => requestReviewChangesSchema.parse({ notes: '   ' }));
    const notes = requestReviewChangesSchema.parse({ notes: ' Fix it ' });
    assert.equal(notes.notes, 'Fix it');
    const page = reviewListQuerySchema.parse({ page: '2', limit: '10', sort: 'score' });
    assert.equal(page.page, 2);
    assert.equal(page.limit, 10);
    assert.throws(() => reviewListQuerySchema.parse({ limit: 101 }));
    assert.throws(() => reviewListQuerySchema.parse({ strain: 'gelato' }));
    assert.deepEqual(submitReviewSchema.parse({}), {});
  });
});
