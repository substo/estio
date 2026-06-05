CREATE TABLE "PropertyMatchCampaign" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "messagePurpose" TEXT NOT NULL DEFAULT 'new_listing',
  "messageLength" TEXT NOT NULL DEFAULT 'short',
  "priorityNote" TEXT,
  "propertySnapshot" JSONB,
  "totalCandidates" INTEGER NOT NULL DEFAULT 0,
  "processedCandidates" INTEGER NOT NULL DEFAULT 0,
  "yesCount" INTEGER NOT NULL DEFAULT 0,
  "maybeCount" INTEGER NOT NULL DEFAULT 0,
  "noCount" INTEGER NOT NULL DEFAULT 0,
  "approvedCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "processingStartedAt" TIMESTAMP(3),
  "processingFinishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "PropertyMatchCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PropertyMatchCandidate" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "reviewedByUserId" TEXT,
  "structuredVerdict" TEXT NOT NULL DEFAULT 'maybe',
  "aiVerdict" TEXT NOT NULL DEFAULT 'maybe',
  "aiReviewStatus" TEXT NOT NULL DEFAULT 'done',
  "aiReviewLockedAt" TIMESTAMP(3),
  "aiReviewLockedBy" TEXT,
  "reviewerStatus" TEXT NOT NULL DEFAULT 'pending',
  "confidence" DOUBLE PRECISION,
  "score" DOUBLE PRECISION,
  "evidence" JSONB,
  "reasoning" TEXT,
  "matchSummary" TEXT,
  "preferredChannel" TEXT,
  "draftBody" TEXT,
  "draftGeneratedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "lastError" TEXT,
  CONSTRAINT "PropertyMatchCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyMatchCampaign_locationId_status_createdAt_idx"
  ON "PropertyMatchCampaign"("locationId", "status", "createdAt" DESC);

CREATE INDEX "PropertyMatchCampaign_propertyId_createdAt_idx"
  ON "PropertyMatchCampaign"("propertyId", "createdAt" DESC);

CREATE UNIQUE INDEX "PropertyMatchCandidate_campaignId_contactId_key"
  ON "PropertyMatchCandidate"("campaignId", "contactId");

CREATE INDEX "PropertyMatchCandidate_locationId_reviewerStatus_createdAt_idx"
  ON "PropertyMatchCandidate"("locationId", "reviewerStatus", "createdAt" DESC);

CREATE INDEX "PropertyMatchCandidate_campaignId_aiReviewStatus_createdAt_idx"
  ON "PropertyMatchCandidate"("campaignId", "aiReviewStatus", "createdAt" ASC);

CREATE INDEX "PropertyMatchCandidate_campaignId_reviewerStatus_aiVerdict_idx"
  ON "PropertyMatchCandidate"("campaignId", "reviewerStatus", "aiVerdict");

CREATE INDEX "PropertyMatchCandidate_campaignId_aiVerdict_idx"
  ON "PropertyMatchCandidate"("campaignId", "aiVerdict");

CREATE INDEX "PropertyMatchCandidate_contactId_createdAt_idx"
  ON "PropertyMatchCandidate"("contactId", "createdAt" DESC);

CREATE INDEX "PropertyMatchCandidate_conversationId_createdAt_idx"
  ON "PropertyMatchCandidate"("conversationId", "createdAt" DESC);

ALTER TABLE "PropertyMatchCampaign"
  ADD CONSTRAINT "PropertyMatchCampaign_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCampaign"
  ADD CONSTRAINT "PropertyMatchCampaign_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCampaign"
  ADD CONSTRAINT "PropertyMatchCampaign_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCandidate"
  ADD CONSTRAINT "PropertyMatchCandidate_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCandidate"
  ADD CONSTRAINT "PropertyMatchCandidate_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "PropertyMatchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCandidate"
  ADD CONSTRAINT "PropertyMatchCandidate_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCandidate"
  ADD CONSTRAINT "PropertyMatchCandidate_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PropertyMatchCandidate"
  ADD CONSTRAINT "PropertyMatchCandidate_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
