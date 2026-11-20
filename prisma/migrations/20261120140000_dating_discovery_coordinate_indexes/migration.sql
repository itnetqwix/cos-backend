-- Coordinate prefilter indexes for 420 Dating discovery.
-- Additive. Does not drop checks, triggers, or the partial primary-photo index.
-- Do not apply this migration to the configured remote database from a dev session.

CREATE INDEX "dating_profiles_status_latitudeFuzzy_idx" ON "dating_profiles"("status", "latitudeFuzzy");
CREATE INDEX "dating_profiles_status_longitudeFuzzy_idx" ON "dating_profiles"("status", "longitudeFuzzy");
