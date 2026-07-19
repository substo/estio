-- Android device egress tunnel foundation.
ALTER TABLE "SmsRelayDevice"
    ADD COLUMN "pairExpiresAt" TIMESTAMP(3),
    ADD COLUMN "pairAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY['sms_relay']::TEXT[],
    ADD COLUMN "appVersion" TEXT,
    ADD COLUMN "tunnelPublicKey" TEXT,
    ADD COLUMN "tunnelCredentialVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "tunnelRevokedAt" TIMESTAMP(3),
    ADD COLUMN "tunnelChallengeHash" TEXT,
    ADD COLUMN "tunnelChallengeExpiresAt" TIMESTAMP(3);

ALTER TABLE "WhatsAppWebBridgeSession"
    ADD COLUMN "egressMode" TEXT NOT NULL DEFAULT 'server';

CREATE TABLE "DeviceTunnelBinding" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "networkType" TEXT,
    "gatewayNodeId" TEXT,
    "egressIpMasked" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "DeviceTunnelBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceTunnelBinding_deviceId_key" ON "DeviceTunnelBinding"("deviceId");
CREATE UNIQUE INDEX "DeviceTunnelBinding_sessionId_key" ON "DeviceTunnelBinding"("sessionId");
CREATE INDEX "DeviceTunnelBinding_locationId_status_idx" ON "DeviceTunnelBinding"("locationId", "status");
CREATE INDEX "DeviceTunnelBinding_status_lastSeenAt_idx" ON "DeviceTunnelBinding"("status", "lastSeenAt");

ALTER TABLE "DeviceTunnelBinding"
    ADD CONSTRAINT "DeviceTunnelBinding_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "DeviceTunnelBinding_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "SmsRelayDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "DeviceTunnelBinding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppWebBridgeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
