import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arithmeticMean,
  categoryAverage,
  combinedCategoryScore,
  missingCategoryNames,
  parseStoredCategories,
  PLEDGE_EXAMPLE_CATEGORIES,
} from '../../src/services/pledge-categories.js';

describe('pledge scoring categories', () => {
  it('uses the example set when nothing has been saved', () => {
    assert.equal(parseStoredCategories(null).length, PLEDGE_EXAMPLE_CATEGORIES.length);
    assert.equal(parseStoredCategories(undefined)[0]?.slug, 'passion');
    assert.equal(parseStoredCategories([]).length, 0);
  });

  it('averages only present ratings and does not treat a missing score as zero', () => {
    assert.equal(arithmeticMean([8, 9, 10]).toFixed(1), '9.0');
    const category = categoryAverage([{ passion: 8 }, { passion: 10 }, { storyline: 1 }, {}], 'passion');
    assert.equal(category.count, 2);
    assert.equal(category.average, 9);
  });

  it('keeps a combined score off the overall winner path', () => {
    const categories = parseStoredCategories(null);
    const combined = combinedCategoryScore({ passion: 10, storyline: 2 }, categories);
    assert.equal(combined, 6);
    const overall = arithmeticMean([9]);
    assert.notEqual(overall, combined);
  });

  it('requires every enabled category', () => {
    const missing = missingCategoryNames(parseStoredCategories(null), { passion: 8 });
    assert.equal(missing.includes('Storyline'), true);
    assert.equal(missing.includes('Passion'), false);
  });
});
