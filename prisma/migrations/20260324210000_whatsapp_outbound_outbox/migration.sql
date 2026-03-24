-- WhatsApp outbound durable outbox + client message correlation

ALTER TABLE "Message"
ADD COLUMN "clientMessageId" TEXT;

CREATE UNIQUE INDEX "Message_clientMessageId_key" ON "Message"("clientMessageId");

CREATE TABLE "WhatsAppOutboundOutbox" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "WhatsAppOutboundOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppOutboundOutbox_messageId_key" ON "WhatsAppOutboundOutbox"("messageId");
CREATE UNIQUE INDEX "WhatsAppOutboundOutbox_idempotencyKey_key" ON "WhatsAppOutboundOutbox"("idempotencyKey");
CREATE INDEX "WhatsAppOutboundOutbox_status_scheduledAt_idx" ON "WhatsAppOutboundOutbox"("status", "scheduledAt");
CREATE INDEX "WhatsAppOutboundOutbox_locationId_status_scheduledAt_idx" ON "WhatsAppOutboundOutbox"("locationId", "status", "scheduledAt");
CREATE INDEX "WhatsAppOutboundOutbox_conversationId_status_scheduledAt_idx" ON "WhatsAppOutboundOutbox"("conversationId", "status", "scheduledAt");

ALTER TABLE "WhatsAppOutboundOutbox"
ADD CONSTRAINT "WhatsAppOutboundOutbox_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppOutboundOutbox"
ADD CONSTRAINT "WhatsAppOutboundOutbox_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppOutboundOutbox"
ADD CONSTRAINT "WhatsAppOutboundOutbox_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppOutboundOutbox"
ADD CONSTRAINT "WhatsAppOutboundOutbox_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
