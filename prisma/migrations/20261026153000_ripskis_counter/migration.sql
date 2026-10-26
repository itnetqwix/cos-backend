-- Singleton baseline for the International Ripskis Counter.
-- The application inserts the provisional row on first read. This migration does not.

CREATE TABLE "ripskis_counter" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "startingEstimate" TEXT NOT NULL,
    "remainderMicros" INTEGER NOT NULL DEFAULT 0,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "frozenHits" TEXT,
    "baseRatePerSecond" DOUBLE PRECISION NOT NULL,
    "weekdayMultipliers" JSONB NOT NULL,
    "fridayBoost" DOUBLE PRECISION NOT NULL,
    "weekendBoost" DOUBLE PRECISION NOT NULL,
    "april20Multiplier" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ripskis_counter_pkey" PRIMARY KEY ("id")
);
