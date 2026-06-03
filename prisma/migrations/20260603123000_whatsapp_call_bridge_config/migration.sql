CREATE TABLE "WhatsAppCallBridgeConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "callingRuntimeMode" TEXT NOT NULL DEFAULT 'baileys_rnd',
    "baileysCallBridgeStatus" TEXT NOT NULL DEFAULT 'offline',
    "baileysSessionId" TEXT,
    "bridgeBaseUrl" TEXT,
    "lastBaileysHeartbeatAt" TIMESTAMP(3),
    "mediaStatus" TEXT NOT NULL DEFAULT 'signaling_only',
    "mediaNotes" TEXT,
    "lastReadinessStatus" TEXT,
    "lastReadinessCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,

    CONSTRAINT "WhatsAppCallBridgeConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppCallBridgeConfig_locationId_key" ON "WhatsAppCallBridgeConfig"("locationId");
CREATE INDEX "WhatsAppCallBridgeConfig_baileysCallBridgeStatus_idx" ON "WhatsAppCallBridgeConfig"("baileysCallBridgeStatus");
CREATE INDEX "WhatsAppCallBridgeConfig_mediaStatus_idx" ON "WhatsAppCallBridgeConfig"("mediaStatus");

ALTER TABLE "WhatsAppCallBridgeConfig" ADD CONSTRAINT "WhatsAppCallBridgeConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
