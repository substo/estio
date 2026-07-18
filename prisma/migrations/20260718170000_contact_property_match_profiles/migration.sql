CREATE TABLE "ContactPropertyMatchProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "eligibilityProfile" JSONB NOT NULL,
    "requirementProfile" JSONB NOT NULL,
    "interactionProfile" JSONB NOT NULL,
    "requirementSummary" TEXT,
    "interactionSummary" TEXT,
    "sourceContactUpdatedAt" TIMESTAMP(3),
    "evidenceWatermarkAt" TIMESTAMP(3),
    "lastBuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "ContactPropertyMatchProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactPropertyInteraction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "propertyId" TEXT,
    "propertyReference" TEXT,
    "propertyUrl" TEXT,
    "eventType" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL DEFAULT 'unknown',
    "signalStrength" TEXT NOT NULL DEFAULT 'observed',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB,
    "metadata" JSONB,

    CONSTRAINT "ContactPropertyInteraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactPropertyMatchProfile_contactId_key" ON "ContactPropertyMatchProfile"("contactId");
CREATE INDEX "ContactPropertyMatchProfile_locationId_status_updatedAt_idx" ON "ContactPropertyMatchProfile"("locationId", "status", "updatedAt" DESC);
CREATE INDEX "ContactPropertyMatchProfile_locationId_evidenceWatermarkAt_idx" ON "ContactPropertyMatchProfile"("locationId", "evidenceWatermarkAt");

CREATE INDEX "ContactPropertyInteraction_locationId_eventType_occurredAt_idx" ON "ContactPropertyInteraction"("locationId", "eventType", "occurredAt" DESC);
CREATE INDEX "ContactPropertyInteraction_contactId_occurredAt_idx" ON "ContactPropertyInteraction"("contactId", "occurredAt" DESC);
CREATE INDEX "ContactPropertyInteraction_contactId_sentiment_occurredAt_idx" ON "ContactPropertyInteraction"("contactId", "sentiment", "occurredAt" DESC);
CREATE INDEX "ContactPropertyInteraction_propertyId_eventType_occurredAt_idx" ON "ContactPropertyInteraction"("propertyId", "eventType", "occurredAt" DESC);
CREATE INDEX "ContactPropertyInteraction_conversationId_occurredAt_idx" ON "ContactPropertyInteraction"("conversationId", "occurredAt" DESC);
CREATE INDEX "ContactPropertyInteraction_sourceType_sourceId_idx" ON "ContactPropertyInteraction"("sourceType", "sourceId");
CREATE UNIQUE INDEX "ContactPropertyInteraction_sourceType_sourceId_eventType_key" ON "ContactPropertyInteraction"("sourceType", "sourceId", "eventType");

ALTER TABLE "ContactPropertyMatchProfile" ADD CONSTRAINT "ContactPropertyMatchProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactPropertyMatchProfile" ADD CONSTRAINT "ContactPropertyMatchProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactPropertyInteraction" ADD CONSTRAINT "ContactPropertyInteraction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactPropertyInteraction" ADD CONSTRAINT "ContactPropertyInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactPropertyInteraction" ADD CONSTRAINT "ContactPropertyInteraction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactPropertyInteraction" ADD CONSTRAINT "ContactPropertyInteraction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
