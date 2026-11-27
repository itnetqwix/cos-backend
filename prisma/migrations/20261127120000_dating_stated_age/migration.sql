-- Age-based onboarding. Existing birthDate values are left unchanged.
ALTER TABLE "dating_profiles" ADD COLUMN "statedAge" INTEGER;
ALTER TABLE "dating_profiles" ALTER COLUMN "birthDate" DROP NOT NULL;

ALTER TABLE "dating_profiles" DROP CONSTRAINT "chk_dating_profile_adult";
ALTER TABLE "dating_profiles" ADD CONSTRAINT "chk_dating_profile_adult" CHECK (
  (
    "birthDate" IS NOT NULL
    AND "birthDate" <= (CURRENT_DATE - INTERVAL '18 years')
    AND ("statedAge" IS NULL OR ("statedAge" >= 18 AND "statedAge" <= 120))
  )
  OR (
    "birthDate" IS NULL
    AND "statedAge" >= 18
    AND "statedAge" <= 120
  )
);
