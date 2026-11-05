-- CreateTable
CREATE TABLE "toke_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toke_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "toke_audit_logs_entityType_entityId_idx" ON "toke_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "toke_audit_logs_actorId_idx" ON "toke_audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "toke_audit_logs_action_idx" ON "toke_audit_logs"("action");

-- CreateIndex
CREATE INDEX "toke_audit_logs_createdAt_idx" ON "toke_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "toke_audit_logs" ADD CONSTRAINT "toke_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

