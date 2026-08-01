CREATE TABLE "UserOffboardingAudit" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "sourceUserId" TEXT NOT NULL,
  "successorUserId" TEXT,
  "mode" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "globalSuspensionRequested" BOOLEAN NOT NULL DEFAULT false,
  "previewJson" JSONB NOT NULL,
  "resultJson" JSONB,
  CONSTRAINT "UserOffboardingAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserOffboardingAudit_confirmationId_key"
ON "UserOffboardingAudit"("confirmationId");
CREATE INDEX "UserOffboardingAudit_locationId_createdAt_idx"
ON "UserOffboardingAudit"("locationId", "createdAt" DESC);
CREATE INDEX "UserOffboardingAudit_sourceUserId_createdAt_idx"
ON "UserOffboardingAudit"("sourceUserId", "createdAt" DESC);
