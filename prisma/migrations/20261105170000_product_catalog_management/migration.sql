-- CreateEnum
CREATE TYPE "ProductApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: Add product metadata, image, batch/strain, label-reported values, active/approval status
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "imageObjectKey" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "strain" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "batchNumber" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reportedThcPercent" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reportedCbdPercent" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "approvalStatus" "ProductApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "submittedById" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_approvalStatus_isActive_idx" ON "products"("approvalStatus", "isActive");
CREATE INDEX IF NOT EXISTS "products_brandName_idx" ON "products"("brandName");
CREATE INDEX IF NOT EXISTS "products_name_idx" ON "products"("name");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_submittedById_fkey'
  ) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_reviewedById_fkey'
  ) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

