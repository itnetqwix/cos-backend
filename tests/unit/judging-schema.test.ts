import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { rateBodySchema, rateParamsSchema } from '../../src/schemas/judging.schema.js';
import { assertRatingValue } from '../../src/services/judging.service.js';
import { ValidationError } from '../../src/utils/response.js';

describe('rating schema', () => {
  it('accepts integers 1 through 5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const parsed = rateBodySchema.parse({ rating });
      assert.equal(parsed.rating, rating);
      assert.equal(parsed.voterFingerprint, undefined);
    }
  });

  it('accepts an optional fingerprint and rejects an empty one', () => {
    const parsed = rateBodySchema.parse({ rating: 4, voterFingerprint: 'device-a' });
    assert.equal(parsed.voterFingerprint, 'device-a');
    assert.throws(() => rateBodySchema.parse({ rating: 4, voterFingerprint: '   ' }), ZodError);
  });

  it('rejects values outside 1–5, non-integers, and non-numbers', () => {
    for (const rating of [0, 6, -1, 1.5, 4.2, '5', null, true]) {
      assert.throws(() => rateBodySchema.parse({ rating }), ZodError);
    }
  });

  it('rejects unknown body keys', () => {
    assert.throws(() => rateBodySchema.parse({ rating: 3, note: 'great' }), ZodError);
  });

  it('requires uuid contest and video ids', () => {
    assert.throws(
      () => rateParamsSchema.parse({ id: 'contest-ripskis', videoId: 'vid-001' }),
      ZodError,
    );
  });

  it('service validation matches the 1–5 integer rule', () => {
    assert.doesNotThrow(() => assertRatingValue(1));
    assert.doesNotThrow(() => assertRatingValue(5));
    assert.throws(() => assertRatingValue(0), ValidationError);
    assert.throws(() => assertRatingValue(6), ValidationError);
    assert.throws(() => assertRatingValue(1.5), ValidationError);
  });
});
