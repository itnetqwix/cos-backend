-- AlterTable
ALTER TABLE "product_reviews" ADD COLUMN "dispensaryAddress" TEXT,
ADD COLUMN "createdByAdminId" TEXT;

-- AlterTable
ALTER TABLE "review_revisions" ADD COLUMN "dispensaryAddress" TEXT;

-- CreateIndex
CREATE INDEX "product_reviews_createdByAdminId_idx" ON "product_reviews"("createdByAdminId");

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

