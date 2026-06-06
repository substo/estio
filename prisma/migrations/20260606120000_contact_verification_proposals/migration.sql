ALTER TABLE "ContactRequirementProposal"
  ADD COLUMN "proposalType" TEXT NOT NULL DEFAULT 'requirements';

CREATE INDEX "ContactRequirementProposal_locationId_proposalType_status_createdAt_idx"
  ON "ContactRequirementProposal"("locationId", "proposalType", "status", "createdAt" DESC);

CREATE INDEX "ContactRequirementProposal_contactId_proposalType_status_createdAt_idx"
  ON "ContactRequirementProposal"("contactId", "proposalType", "status", "createdAt" DESC);
