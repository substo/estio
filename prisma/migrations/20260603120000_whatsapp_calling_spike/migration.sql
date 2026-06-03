-- Baileys/NOWEB call bridge R&D spike.
CREATE TABLE "WhatsAppCallAttempt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "provider" TEXT NOT NULL DEFAULT 'baileys_rnd',
    "providerCallId" TEXT,
    "bridgeCallId" TEXT,
    "whatsappCallId" TEXT,
    "requestMessageId" TEXT,
    "consentMessageId" TEXT,
    "requestedAt" TIMESTAMP(3),
    "consentedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "contactPhone" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "WhatsAppCallAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppCallAttempt_locationId_status_createdAt_idx" ON "WhatsAppCallAttempt"("locationId", "status", "createdAt" DESC);
CREATE INDEX "WhatsAppCallAttempt_conversationId_createdAt_idx" ON "WhatsAppCallAttempt"("conversationId", "createdAt" DESC);
CREATE INDEX "WhatsAppCallAttempt_contactId_status_createdAt_idx" ON "WhatsAppCallAttempt"("contactId", "status", "createdAt" DESC);
CREATE INDEX "WhatsAppCallAttempt_providerCallId_idx" ON "WhatsAppCallAttempt"("providerCallId");
CREATE INDEX "WhatsAppCallAttempt_bridgeCallId_idx" ON "WhatsAppCallAttempt"("bridgeCallId");
CREATE INDEX "WhatsAppCallAttempt_whatsappCallId_idx" ON "WhatsAppCallAttempt"("whatsappCallId");

ALTER TABLE "WhatsAppCallAttempt" ADD CONSTRAINT "WhatsAppCallAttempt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppCallAttempt" ADD CONSTRAINT "WhatsAppCallAttempt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppCallAttempt" ADD CONSTRAINT "WhatsAppCallAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
