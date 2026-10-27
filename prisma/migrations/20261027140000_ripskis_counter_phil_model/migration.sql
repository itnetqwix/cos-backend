-- Phil's assumption fields and audit history.
-- Existing weekday multipliers, boosts, and the cumulative baseline are left as stored.
-- New columns receive defaults only. This migration does not rewrite the running count.

ALTER TABLE "ripskis_counter" ADD COLUMN "estimatedUsers" TEXT NOT NULL DEFAULT '256000000';
ALTER TABLE "ripskis_counter" ADD COLUMN "averageUsesPerUserPerDay" DOUBLE PRECISION NOT NULL DEFAULT 3.2;
ALTER TABLE "ripskis_counter" ADD COLUMN "manualRatePerSecond" DOUBLE PRECISION;
ALTER TABLE "ripskis_counter" ADD COLUMN "useAssumptions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ripskis_counter" ADD COLUMN "specialMonth" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "ripskis_counter" ADD COLUMN "specialDay" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "ripskis_counter" ADD COLUMN "specialMode" TEXT NOT NULL DEFAULT 'override';
ALTER TABLE "ripskis_counter" ADD COLUMN "specialDates" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ripskis_counter" ADD COLUMN "pendingConfig" JSONB;
ALTER TABLE "ripskis_counter" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ripskis_counter_audits" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    CONSTRAINT "ripskis_counter_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ripskis_counter_audits_createdAt_idx" ON "ripskis_counter_audits"("createdAt");
