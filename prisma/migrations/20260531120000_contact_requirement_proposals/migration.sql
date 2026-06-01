ALTER TABLE "Contact"
  ADD COLUMN "requirementSummary" TEXT;

CREATE TABLE "ContactRequirementProposal" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceIds" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "currentSnapshot" JSONB,
  "proposedPatch" JSONB,
  "proposedSummary" TEXT,
  "evidence" JSONB,
  "confidence" DOUBLE PRECISION,
  "reasoning" TEXT,
  "rejectedReason" TEXT,
  "model" TEXT,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedCostUsd" DOUBLE PRECISION,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "rejectedByUserId" TEXT,
  CONSTRAINT "ContactRequirementProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactRequirementProposal_locationId_status_createdAt_idx"
  ON "ContactRequirementProposal"("locationId", "status", "createdAt" DESC);

CREATE INDEX "ContactRequirementProposal_contactId_status_createdAt_idx"
  ON "ContactRequirementProposal"("contactId", "status", "createdAt" DESC);

CREATE INDEX "ContactRequirementProposal_conversationId_status_createdAt_idx"
  ON "ContactRequirementProposal"("conversationId", "status", "createdAt" DESC);

ALTER TABLE "ContactRequirementProposal"
  ADD CONSTRAINT "ContactRequirementProposal_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRequirementProposal"
  ADD CONSTRAINT "ContactRequirementProposal_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRequirementProposal"
  ADD CONSTRAINT "ContactRequirementProposal_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactRequirementProposal"
  ADD CONSTRAINT "ContactRequirementProposal_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactRequirementProposal"
  ADD CONSTRAINT "ContactRequirementProposal_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
