-- Horizontal device-egress control-plane primitives. Runtime enforcement is
-- separately feature flagged so the existing single-node data path remains in use.
CREATE TABLE "DeviceTunnelGatewayNode" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'default',
    "publicUrl" TEXT,
    "internalUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "capacitySessions" INTEGER NOT NULL DEFAULT 1,
    "activeSessions" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "DeviceTunnelGatewayNode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeviceTunnelGatewayNode_capacitySessions_check" CHECK ("capacitySessions" > 0),
    CONSTRAINT "DeviceTunnelGatewayNode_activeSessions_check" CHECK ("activeSessions" >= 0),
    CONSTRAINT "DeviceTunnelGatewayNode_status_check" CHECK ("status" IN ('online', 'draining', 'offline', 'quarantined'))
);

ALTER TABLE "DeviceTunnelBinding"
    ADD COLUMN "assignmentEpoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "assignedAt" TIMESTAMP(3),
    ADD COLUMN "desiredState" TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN "drainRequestedAt" TIMESTAMP(3);

ALTER TABLE "DeviceTunnelBinding"
    ADD CONSTRAINT "DeviceTunnelBinding_assignmentEpoch_check" CHECK ("assignmentEpoch" >= 0),
    ADD CONSTRAINT "DeviceTunnelBinding_desiredState_check" CHECK ("desiredState" IN ('active', 'draining', 'disabled'));

-- Preserve any observational node IDs written by the legacy gateway before
-- adding the registry foreign key. They remain offline until a gateway with
-- the same stable ID heartbeats.
INSERT INTO "DeviceTunnelGatewayNode" (
    "id", "updatedAt", "region", "status", "capacitySessions", "activeSessions", "startedAt", "lastHeartbeatAt", "metadata"
)
SELECT DISTINCT
    "gatewayNodeId", CURRENT_TIMESTAMP, 'default', 'offline', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
    '{"source":"legacy-binding-backfill"}'::jsonb
FROM "DeviceTunnelBinding"
WHERE "gatewayNodeId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "DeviceTunnelSessionLease" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "gatewayNodeId" TEXT NOT NULL,
    "ownerInstanceId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'acquiring',

    CONSTRAINT "DeviceTunnelSessionLease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeviceTunnelSessionLease_epoch_check" CHECK ("epoch" > 0),
    CONSTRAINT "DeviceTunnelSessionLease_state_check" CHECK ("state" IN ('acquiring', 'active', 'draining', 'expired'))
);

CREATE UNIQUE INDEX "DeviceTunnelSessionLease_sessionId_key" ON "DeviceTunnelSessionLease"("sessionId");
CREATE UNIQUE INDEX "DeviceTunnelSessionLease_bindingId_key" ON "DeviceTunnelSessionLease"("bindingId");
CREATE INDEX "DeviceTunnelGatewayNode_region_status_lastHeartbeatAt_idx" ON "DeviceTunnelGatewayNode"("region", "status", "lastHeartbeatAt");
CREATE INDEX "DeviceTunnelGatewayNode_status_lastHeartbeatAt_idx" ON "DeviceTunnelGatewayNode"("status", "lastHeartbeatAt");
CREATE INDEX "DeviceTunnelBinding_gatewayNodeId_desiredState_idx" ON "DeviceTunnelBinding"("gatewayNodeId", "desiredState");
CREATE INDEX "DeviceTunnelSessionLease_gatewayNodeId_state_expiresAt_idx" ON "DeviceTunnelSessionLease"("gatewayNodeId", "state", "expiresAt");
CREATE INDEX "DeviceTunnelSessionLease_state_expiresAt_idx" ON "DeviceTunnelSessionLease"("state", "expiresAt");

ALTER TABLE "DeviceTunnelBinding"
    ADD CONSTRAINT "DeviceTunnelBinding_gatewayNodeId_fkey" FOREIGN KEY ("gatewayNodeId") REFERENCES "DeviceTunnelGatewayNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceTunnelSessionLease"
    ADD CONSTRAINT "DeviceTunnelSessionLease_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppWebBridgeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "DeviceTunnelSessionLease_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "DeviceTunnelBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "DeviceTunnelSessionLease_gatewayNodeId_fkey" FOREIGN KEY ("gatewayNodeId") REFERENCES "DeviceTunnelGatewayNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
