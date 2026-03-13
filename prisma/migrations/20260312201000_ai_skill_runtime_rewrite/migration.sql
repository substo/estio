-- CreateTable
CREATE TABLE "AiSkillPolicy" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "objective" TEXT NOT NULL DEFAULT 'nurture',
  "channelPolicy" JSONB,
  "contactSegments" JSONB,
  "decisionPolicy" JSONB,
  "compliancePolicy" JSONB,
  "stylePolicy" JSONB,
  "researchPolicy" JSONB,
  "humanApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  CONSTRAINT "AiSkillPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecision" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "policyId" TEXT,
  "conversationId" TEXT,
  "contactId" TEXT,
  "dealId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'automation',
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "holdReason" TEXT,
  "rejectedReason" TEXT,
  "selectedSkillId" TEXT,
  "selectedObjective" TEXT,
  "selectedScore" DOUBLE PRECISION,
  "scoreBreakdown" JSONB,
  "evaluatedSkills" JSONB,
  "decisionContext" JSONB,
  "traceId" TEXT,
  "policyVersion" INTEGER,
  CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRuntimeJob" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 6,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "traceId" TEXT,
  "payload" JSONB,
  CONSTRAINT "AiRuntimeJob_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AiSuggestedResponse"
  ADD COLUMN "decisionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiSkillPolicy_locationId_skillId_key" ON "AiSkillPolicy"("locationId", "skillId");
CREATE INDEX "AiSkillPolicy_locationId_enabled_idx" ON "AiSkillPolicy"("locationId", "enabled");
CREATE INDEX "AiSkillPolicy_locationId_objective_enabled_idx" ON "AiSkillPolicy"("locationId", "objective", "enabled");

CREATE UNIQUE INDEX "AiDecision_locationId_dueKey_key" ON "AiDecision"("locationId", "dueKey");
CREATE INDEX "AiDecision_locationId_status_dueAt_idx" ON "AiDecision"("locationId", "status", "dueAt");
CREATE INDEX "AiDecision_policyId_status_dueAt_idx" ON "AiDecision"("policyId", "status", "dueAt");
CREATE INDEX "AiDecision_conversationId_status_dueAt_idx" ON "AiDecision"("conversationId", "status", "dueAt");
CREATE INDEX "AiDecision_contactId_status_dueAt_idx" ON "AiDecision"("contactId", "status", "dueAt");
CREATE INDEX "AiDecision_dealId_status_dueAt_idx" ON "AiDecision"("dealId", "status", "dueAt");

CREATE UNIQUE INDEX "AiRuntimeJob_idempotencyKey_key" ON "AiRuntimeJob"("idempotencyKey");
CREATE INDEX "AiRuntimeJob_status_scheduledAt_idx" ON "AiRuntimeJob"("status", "scheduledAt");
CREATE INDEX "AiRuntimeJob_locationId_status_scheduledAt_idx" ON "AiRuntimeJob"("locationId", "status", "scheduledAt");
CREATE INDEX "AiRuntimeJob_decisionId_status_idx" ON "AiRuntimeJob"("decisionId", "status");

CREATE INDEX "AiSuggestedResponse_decisionId_status_createdAt_idx" ON "AiSuggestedResponse"("decisionId", "status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AiSkillPolicy"
  ADD CONSTRAINT "AiSkillPolicy_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiDecision"
  ADD CONSTRAINT "AiDecision_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiDecision"
  ADD CONSTRAINT "AiDecision_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "AiSkillPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiDecision"
  ADD CONSTRAINT "AiDecision_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiDecision"
  ADD CONSTRAINT "AiDecision_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiDecision"
  ADD CONSTRAINT "AiDecision_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "DealContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiRuntimeJob"
  ADD CONSTRAINT "AiRuntimeJob_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiRuntimeJob"
  ADD CONSTRAINT "AiRuntimeJob_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "AiDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "AiDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
