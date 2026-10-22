-- In-app notifications (ported from Woofskis, Ripskis branding-neutral)
CREATE TYPE "NotificationType" AS ENUM ('SUBMISSION_PENDING_REVIEW', 'SUBMISSION_APPROVED', 'SUBMISSION_DELETED');

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "submissionId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notifications_userId_type_submissionId_key" ON "notifications"("userId", "type", "submissionId");
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Video categories reuse the contest Category catalog.
ALTER TABLE "categories" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "categories" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "categories_name_lower_key" ON "categories" (lower(btrim("name")));
ALTER TABLE "submissions" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "submissions" ADD COLUMN "otherCategoryLabel" TEXT;
CREATE INDEX "submissions_categoryId_idx" ON "submissions"("categoryId");
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
