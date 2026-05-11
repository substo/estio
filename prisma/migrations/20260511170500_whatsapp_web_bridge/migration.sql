-- Self-hosted WhatsApp Web bridge sessions.
CREATE TABLE IF NOT EXISTS "WhatsAppWebBridgeSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "qrCode" TEXT,
    "lastReadyAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isDefaultOutbound" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    CONSTRAINT "WhatsAppWebBridgeSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppWebBridgeSession_locationId_key"
ON "WhatsAppWebBridgeSession"("locationId");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppWebBridgeSession_sessionId_key"
ON "WhatsAppWebBridgeSession"("sessionId");

CREATE INDEX IF NOT EXISTS "WhatsAppWebBridgeSession_locationId_isDefaultOutbound_idx"
ON "WhatsAppWebBridgeSession"("locationId", "isDefaultOutbound");

CREATE INDEX IF NOT EXISTS "WhatsAppWebBridgeSession_status_idx"
ON "WhatsAppWebBridgeSession"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'WhatsAppWebBridgeSession_locationId_fkey'
    ) THEN
        ALTER TABLE "WhatsAppWebBridgeSession"
        ADD CONSTRAINT "WhatsAppWebBridgeSession_locationId_fkey"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
