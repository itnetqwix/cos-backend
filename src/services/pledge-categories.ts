/**
 * Pledge scoring categories. Separate from video Category and from One Toke
 * ReviewCategory. Overall is Rating.rating, not one of these rows.
 * Combined score, when enabled, never selects the Overall winner.
 */

export interface PledgeScoreCategory {
  slug: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
  weight: number;
}

/** Approved example set used when a Pledge template has not saved its own list. */
export const PLEDGE_EXAMPLE_CATEGORIES: PledgeScoreCategory[] = [
  { slug: 'passion', name: 'Passion', sortOrder: 1, enabled: true, weight: 1 },
  { slug: 'storyline', name: 'Storyline', sortOrder: 2, enabled: true, weight: 1 },
  { slug: 'choreography', name: 'Choreography', sortOrder: 3, enabled: true, weight: 1 },
  {
    slug: 'musical-score',
    name: 'Musical Score',
    sortOrder: 4,
    enabled: true,
    weight: 1,
  },
];

export function categorySlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'category';
}

export function enabledCategories(rows: PledgeScoreCategory[]): PledgeScoreCategory[] {
  return rows
    .filter((row) => row.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

/** Null or a non-array means the example set. An array is the saved list, including empty. */
export function parseStoredCategories(value: unknown): PledgeScoreCategory[] {
  if (value == null) return PLEDGE_EXAMPLE_CATEGORIES.map((row) => ({ ...row }));
  if (!Array.isArray(value)) return PLEDGE_EXAMPLE_CATEGORIES.map((row) => ({ ...row }));
  const parsed: PledgeScoreCategory[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return;
    const slug =
      typeof record.slug === 'string' && record.slug.trim()
        ? categorySlug(record.slug)
        : categorySlug(name);
    const weight =
      typeof record.weight === 'number' && record.weight > 0 ? record.weight : 1;
    parsed.push({
      slug,
      name,
      sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : index + 1,
      enabled: record.enabled !== false,
      weight,
    });
  });
  return parsed;
}

export function arithmeticMean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function categoryScoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scores: Record<string, number> = {};
  for (const [slug, score] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof score === 'number' &&
      Number.isInteger(score) &&
      score >= 1 &&
      score <= 10
    ) {
      scores[categorySlug(slug)] = score;
    }
  }
  return scores;
}

/** Missing category values are skipped. They are not zero. */
export function categoryAverage(
  scores: Array<Record<string, number> | null | undefined>,
  slug: string,
): { average: number | null; count: number } {
  const values = scores.flatMap((row) => {
    const score = row?.[slug];
    return typeof score === 'number' ? [score] : [];
  });
  return { average: arithmeticMean(values), count: values.length };
}

export function combinedCategoryScore(
  scores: Record<string, number>,
  categories: PledgeScoreCategory[],
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const category of enabledCategories(categories)) {
    const score = scores[category.slug];
    if (typeof score !== 'number') continue;
    weighted += score * category.weight;
    weight += category.weight;
  }
  if (weight === 0) return null;
  return Math.round((weighted / weight) * 10) / 10;
}

export function missingCategoryNames(
  categories: PledgeScoreCategory[],
  scores: Record<string, number> | null | undefined,
): string[] {
  return enabledCategories(categories)
    .filter((category) => {
      const score = scores?.[category.slug];
      return !Number.isInteger(score) || (score as number) < 1 || (score as number) > 10;
    })
    .map((category) => category.name);
}
