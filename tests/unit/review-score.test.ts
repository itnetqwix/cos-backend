import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOverallScore,
  freezeWeightsSnapshot,
  type WeightedCategory,
} from '../../src/services/review-score.service.js';
import { ValidationError } from '../../src/utils/response.js';

const smell: WeightedCategory = { id: 'smell', name: 'Smell', slug: 'smell', weight: 1 };
const taste: WeightedCategory = { id: 'taste', name: 'Taste', slug: 'taste', weight: 1 };
const potency: WeightedCategory = { id: 'potency', name: 'Potency', slug: 'potency', weight: 3 };

describe('weighted review score', () => {
  it('averages equal weights and rounds to one decimal', () => {
    const result = calculateOverallScore(
      [
        { categoryId: 'smell', score: 8 },
        { categoryId: 'taste', score: 6 },
      ],
      [smell, taste],
    );
    assert.equal(result.overallScore, 7);
    assert.deepEqual(
      result.weightsSnapshot.map((entry) => entry.categoryId),
      ['smell', 'taste'],
    );
  });

  it('weights unequal categories and rounds 3.25 to 3.3', () => {
    const result = calculateOverallScore(
      [
        { categoryId: 'smell', score: 10 },
        { categoryId: 'potency', score: 1 },
      ],
      [smell, potency],
    );
    assert.equal(result.overallScore, 3.3);
    assert.equal(result.weightsSnapshot.find((entry) => entry.categoryId === 'potency')?.weight, 3);
  });

  it('rounds a repeating tenth without float drift', () => {
    const third: WeightedCategory = { id: 'texture', name: 'Texture', slug: 'texture', weight: 1 };
    const result = calculateOverallScore(
      [
        { categoryId: 'smell', score: 1 },
        { categoryId: 'taste', score: 2 },
        { categoryId: 'texture', score: 2 },
      ],
      [smell, taste, third],
    );
    assert.equal(result.overallScore, 1.7);
  });

  it('keeps a frozen snapshot after later category weight edits', () => {
    const live = [{ ...smell }, { ...taste, weight: 4 }];
    const frozen = freezeWeightsSnapshot(live);
    live[1].weight = 99;
    live[1].name = 'Renamed';
    const again = calculateOverallScore(
      [
        { categoryId: 'smell', score: 8 },
        { categoryId: 'taste', score: 2 },
      ],
      frozen.map((entry) => ({
        id: entry.categoryId,
        name: entry.name,
        slug: entry.slug,
        weight: entry.weight,
      })),
    );
    assert.equal(frozen[1].weight, 4);
    assert.equal(frozen[1].name, 'Taste');
    assert.equal(again.overallScore, 3.2);
    assert.equal(again.weightsSnapshot[1].weight, 4);
  });

  it('skips inactive categories and still requires the active ones', () => {
    const retired: WeightedCategory = {
      id: 'old',
      name: 'Old',
      slug: 'old',
      weight: 9,
      isActive: false,
    };
    const snapshot = freezeWeightsSnapshot([retired, taste]);
    assert.deepEqual(snapshot.map((entry) => entry.categoryId), ['taste']);
    assert.throws(
      () => calculateOverallScore([{ categoryId: 'old', score: 5 }], [retired, taste]),
      ValidationError,
    );
  });

  it('rejects empty scores, missing categories, bad scores, and bad weights', () => {
    assert.throws(() => calculateOverallScore([], [smell]), (error: unknown) => {
      return error instanceof ValidationError && /at least one category score/i.test(error.message);
    });
    assert.throws(
      () => calculateOverallScore([{ categoryId: 'smell', score: 8 }], [smell, taste]),
      /required active categories/,
    );
    for (const score of [0, 11, 1.5, Number.NaN]) {
      assert.throws(
        () => calculateOverallScore([{ categoryId: 'smell', score }], [smell]),
        ValidationError,
      );
    }
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => calculateOverallScore([{ categoryId: 'smell', score: 5 }], [{ ...smell, weight }]),
        ValidationError,
      );
    }
    assert.throws(
      () => calculateOverallScore([{ categoryId: 'smell', score: 5 }], []),
      /total category weight/i,
    );
  });
});
