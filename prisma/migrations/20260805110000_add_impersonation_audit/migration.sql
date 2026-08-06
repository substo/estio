CREATE TYPE "ImpersonationAuditStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED', 'FAILED', 'EXPIRED');

CREATE TABLE "ImpersonationAudit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "actorClerkId" TEXT NOT NULL,
    "targetClerkId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ImpersonationAuditStatus" NOT NULL DEFAULT 'PENDING',
    "clerkActorTokenId" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "targetSessionId" TEXT,
    "endReason" TEXT,
    CONSTRAINT "ImpersonationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImpersonationAudit_clerkActorTokenId_key" ON "ImpersonationAudit"("clerkActorTokenId");
CREATE INDEX "ImpersonationAudit_actorUserId_createdAt_idx" ON "ImpersonationAudit"("actorUserId", "createdAt" DESC);
CREATE INDEX "ImpersonationAudit_targetUserId_createdAt_idx" ON "ImpersonationAudit"("targetUserId", "createdAt" DESC);
CREATE INDEX "ImpersonationAudit_locationId_createdAt_idx" ON "ImpersonationAudit"("locationId", "createdAt" DESC);
CREATE INDEX "ImpersonationAudit_status_sessionExpiresAt_idx" ON "ImpersonationAudit"("status", "sessionExpiresAt");

ALTER TABLE "ImpersonationAudit" ADD CONSTRAINT "ImpersonationAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImpersonationAudit" ADD CONSTRAINT "ImpersonationAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImpersonationAudit" ADD CONSTRAINT "ImpersonationAudit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
