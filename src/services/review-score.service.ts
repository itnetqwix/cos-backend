import { ValidationError } from '../utils/response.js';

/**
 * Weighted One Toke score (M02-P01-T01).
 *
 * overallScore = round(sum(score * weight) / sum(weight), 1)
 * Weights are scaled to millionths so the tenth is not a binary float accident.
 * The returned snapshot is the only weight record a published review may use.
 */

const WEIGHT_SCALE = 1_000_000;

export interface CategoryScoreInput {
  categoryId: string;
  score: number;
}

export interface WeightedCategory {
  id: string;
  name: string;
  slug: string;
  weight: number;
  /** Omitted or true means the category is required. */
  isActive?: boolean;
}

export interface FrozenCategoryWeight {
  categoryId: string;
  name: string;
  slug: string;
  weight: number;
}

export interface OverallScoreResult {
  overallScore: number;
  weightsSnapshot: FrozenCategoryWeight[];
}

function weightUnits(weight: number): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
    throw new ValidationError('Category weight must be a finite positive number');
  }
  const units = Math.round(weight * WEIGHT_SCALE);
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new ValidationError('Category weight must be a finite positive number');
  }
  return units;
}

export function freezeWeightsSnapshot(
  categories: WeightedCategory[],
): FrozenCategoryWeight[] {
  const seen = new Set<string>();
  const frozen: FrozenCategoryWeight[] = [];
  for (const category of categories) {
    if (category.isActive === false) continue;
    if (!category.id || !category.name?.trim() || !category.slug?.trim()) {
      throw new ValidationError('Active category id, name, and slug are required');
    }
    if (seen.has(category.id)) {
      throw new ValidationError('Duplicate category weight');
    }
    seen.add(category.id);
    weightUnits(category.weight);
    frozen.push({
      categoryId: category.id,
      name: category.name,
      slug: category.slug,
      weight: category.weight,
    });
  }
  frozen.sort((a, b) =>
    a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0,
  );
  return frozen;
}

export function calculateOverallScore(
  scores: CategoryScoreInput[],
  categoriesWithWeights: WeightedCategory[],
): OverallScoreResult {
  if (!Array.isArray(scores) || scores.length === 0) {
    throw new ValidationError('At least one category score is required');
  }
  const weightsSnapshot = freezeWeightsSnapshot(categoriesWithWeights);
  if (weightsSnapshot.length === 0) {
    throw new ValidationError('Total category weight must be greater than zero');
  }

  const required = new Map(weightsSnapshot.map((entry) => [entry.categoryId, entry]));
  const seen = new Set<string>();
  let numerator = 0;
  let denominator = 0;

  for (const entry of scores) {
    const category = entry ? required.get(entry.categoryId) : undefined;
    if (!category) {
      throw new ValidationError('Score does not match a required active category');
    }
    if (seen.has(entry.categoryId)) {
      throw new ValidationError('Duplicate category score');
    }
    seen.add(entry.categoryId);
    if (!Number.isInteger(entry.score) || entry.score < 1 || entry.score > 10) {
      throw new ValidationError('Category score must be an integer from 1 to 10');
    }
    const units = weightUnits(category.weight);
    numerator += entry.score * units;
    denominator += units;
  }

  if (seen.size !== required.size) {
    throw new ValidationError('All required active categories must have a score');
  }
  if (denominator <= 0) {
    throw new ValidationError('Total category weight must be greater than zero');
  }

  const tenths = Math.round((numerator * 10) / denominator);
  return { overallScore: tenths / 10, weightsSnapshot };
}

export class ReviewScoreService {
  static calculateOverallScore = calculateOverallScore;
  static freezeWeightsSnapshot = freezeWeightsSnapshot;
}
