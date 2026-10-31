import { z } from 'zod';

/**
 * Recurring template writes. Persisted Contest columns only.
 * Not accepted, because they are not columns:
 * a non-UTC cycle, a frequency other than monthly,
 * prize breakdown beyond prizeSummary.
 * Timezone is always UTC and is not a request field.
 */

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Series slug is invalid');

const rulesSchema = z.union([z.string().trim().min(1), z.array(z.string())]);

const optionalText = z.string().trim().max(2000).nullable().optional();

const votersSchema = z.number().int().min(1).max(1_000_000);

const scoringCategorySchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    name: z.string().trim().min(1).max(80),
    sortOrder: z.number().int().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
    weight: z.number().positive().max(100).optional(),
  })
  .strict();

export const createRecurringContestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1),
    seriesSlug: slugSchema,
    tagline: optionalText,
    bannerUrl: optionalText,
    bannerObjectKey: z.string().trim().min(1).max(512).nullable().optional(),
    thumbnailUrl: optionalText,
    enabled: z.boolean().optional().default(true),
    categoryId: z.string().uuid().nullable().optional(),
    prizeSummary: z.string().trim().max(500).nullable().optional(),
    rules: rulesSchema.nullable().optional(),
    autoAdvanceDelayMs: z.number().int().positive().max(60_000).optional(),
    minOverallVoters: votersSchema.optional().default(10),
    minCategoryVoters: votersSchema.optional().default(5),
    scoringCategories: z.array(scoringCategorySchema).max(20).optional(),
    combinedScoreEnabled: z.boolean().optional(),
  })
  .strict();

export type CreateRecurringContestInput = z.infer<typeof createRecurringContestSchema>;

export const updateRecurringContestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).optional(),
    tagline: optionalText,
    bannerUrl: optionalText,
    bannerObjectKey: z.string().trim().min(1).max(512).nullable().optional(),
    thumbnailUrl: optionalText,
    enabled: z.boolean().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    prizeSummary: z.string().trim().max(500).nullable().optional(),
    rules: rulesSchema.nullable().optional(),
    autoAdvanceDelayMs: z.number().int().positive().max(60_000).optional(),
    minOverallVoters: votersSchema.optional(),
    minCategoryVoters: votersSchema.optional(),
    scoringCategories: z.array(scoringCategorySchema).max(20).optional(),
    combinedScoreEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type UpdateRecurringContestInput = z.infer<typeof updateRecurringContestSchema>;

export const recurringContestIdParamSchema = z.object({
  id: z.string().uuid(),
});
