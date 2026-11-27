import { Prisma } from '@prisma/client';
import { DatingProfileRecord } from './dating-profile.repository.js';
import { birthDateBounds, boundingBox } from '../services/dating-geo.js';
import { ValidationError } from '../utils/response.js';

/** Same weights as preferenceScore. Change both together. */
export const DISCOVER_SCORE = {
  gender: 4,
  intention: 2,
  habit: 1,
  verified: 1,
} as const;

function textArray(values: string[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]`;
}

export function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?');
}

/**
 * Eligible profiles, newest tie-break, score across the whole set.
 * Exclusions are NOT EXISTS lookups, not an in-memory id list.
 * Distance dealbreaker is the bounding box plus the same rounded miles as distanceMiles.
 */
export function discoverCandidateQuery(input: {
  viewer: DatingProfileRecord;
  skip: number;
  take: number;
  now?: Date;
}): { list: Prisma.Sql; count: Prisma.Sql } {
  const preferences = input.viewer.preferences;
  if (!preferences) throw new ValidationError('Dating preferences are missing');
  const viewerId = input.viewer.id;
  const clauses: Prisma.Sql[] = [
    Prisma.sql`p."status" = 'ACTIVE'`,
    Prisma.sql`p."id" <> ${viewerId}`,
    Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "dating_likes" sent
      WHERE sent."senderProfileId" = ${viewerId}
        AND sent."receiverProfileId" = p."id"
    )`,
    Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "dating_matches" pair
      WHERE (pair."profileLowId" = ${viewerId} AND pair."profileHighId" = p."id")
         OR (pair."profileHighId" = ${viewerId} AND pair."profileLowId" = p."id")
    )`,
    Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "dating_blocks" block
      WHERE (block."blockerProfileId" = ${viewerId} AND block."blockedProfileId" = p."id")
         OR (block."blockedProfileId" = ${viewerId} AND block."blockerProfileId" = p."id")
    )`,
    Prisma.sql`(
      p."isIncognito" = false
      OR EXISTS (
        SELECT 1 FROM "dating_likes" incoming
        WHERE incoming."senderProfileId" = p."id"
          AND incoming."receiverProfileId" = ${viewerId}
          AND incoming."isPass" = false
      )
    )`,
  ];
  if (preferences.ageDealbreaker) {
    const bounds = birthDateBounds(
      preferences.minAge,
      preferences.maxAge,
      input.now ?? new Date(),
    );
    clauses.push(
      Prisma.sql`(
        (p."birthDate" IS NOT NULL AND p."birthDate" > ${bounds.earliestExclusive} AND p."birthDate" <= ${bounds.latestInclusive})
        OR (p."statedAge" IS NOT NULL AND p."statedAge" >= ${preferences.minAge} AND p."statedAge" <= ${preferences.maxAge})
      )`,
    );
  }
  if (preferences.genderDealbreaker) {
    clauses.push(
      Prisma.sql`p."gender"::text = ANY(${textArray(preferences.targetGenders)})`,
    );
  }
  if (
    preferences.cannabisHabitsDealbreaker &&
    preferences.cannabisHabitsFilter.length > 0
  ) {
    clauses.push(
      Prisma.sql`p."consumptionHabits" && ${textArray(preferences.cannabisHabitsFilter)}`,
    );
  }
  if (preferences.intentionsDealbreaker && preferences.intentionsFilter.length > 0) {
    clauses.push(
      Prisma.sql`p."datingIntention"::text = ANY(${textArray(preferences.intentionsFilter)})`,
    );
  }
  if (preferences.verifiedOnly) {
    clauses.push(Prisma.sql`p."verificationStatus"::text = 'VERIFIED'`);
  }
  if (
    preferences.distanceDealbreaker &&
    input.viewer.latitudeFuzzy != null &&
    input.viewer.longitudeFuzzy != null
  ) {
    const box = boundingBox(
      input.viewer.latitudeFuzzy,
      input.viewer.longitudeFuzzy,
      preferences.maxDistanceMiles,
    );
    clauses.push(Prisma.sql`(
      p."latitudeFuzzy" IS NOT NULL
      AND p."longitudeFuzzy" IS NOT NULL
      AND p."latitudeFuzzy" BETWEEN ${box.minLat} AND ${box.maxLat}
      AND p."longitudeFuzzy" BETWEEN ${box.minLng} AND ${box.maxLng}
      AND ROUND((2 * 3958.8 * ASIN(LEAST(1, SQRT(
        POWER(SIN(RADIANS(p."latitudeFuzzy" - ${input.viewer.latitudeFuzzy}) / 2), 2)
        + COS(RADIANS(${input.viewer.latitudeFuzzy})) * COS(RADIANS(p."latitudeFuzzy"))
          * POWER(SIN(RADIANS(p."longitudeFuzzy" - ${input.viewer.longitudeFuzzy}) / 2), 2)
      ))))::numeric) <= ${preferences.maxDistanceMiles}
    )`);
  }
  const genders = textArray(preferences.targetGenders);
  const intentions = textArray(preferences.intentionsFilter);
  const habits = textArray(preferences.cannabisHabitsFilter);
  const score = Prisma.sql`(
    CASE WHEN p."gender"::text = ANY(${genders}) THEN ${DISCOVER_SCORE.gender} ELSE 0 END
    + CASE WHEN p."datingIntention"::text = ANY(${intentions}) THEN ${DISCOVER_SCORE.intention} ELSE 0 END
    + CASE WHEN cardinality(${habits}) = 0 OR p."consumptionHabits" && ${habits}
      THEN ${DISCOVER_SCORE.habit} ELSE 0 END
    + CASE WHEN ${preferences.verifiedOnly} = FALSE AND p."verificationStatus"::text = 'VERIFIED'
      THEN ${DISCOVER_SCORE.verified} ELSE 0 END
  )`;
  const where = Prisma.join(clauses, ' AND ');
  return {
    list: Prisma.sql`
      SELECT p."id"
      FROM "dating_profiles" p
      WHERE ${where}
      ORDER BY ${score} DESC, p."createdAt" DESC, p."id" ASC
      OFFSET ${input.skip} LIMIT ${input.take}
    `,
    count: Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "dating_profiles" p
      WHERE ${where}
    `,
  };
}
