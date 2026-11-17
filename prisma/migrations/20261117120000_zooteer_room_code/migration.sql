-- Stable room code. Apply locally. Do not run this against production from the app deploy.
ALTER TABLE "zooteer_rooms" ADD COLUMN "code" TEXT;

UPDATE "zooteer_rooms"
SET "code" = upper(substr(md5("id"::text), 1, 8))
WHERE "code" IS NULL;

ALTER TABLE "zooteer_rooms" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "zooteer_rooms_code_key" ON "zooteer_rooms"("code");
