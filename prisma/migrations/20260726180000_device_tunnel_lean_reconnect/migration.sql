-- Durable, idempotent reconnect requests for the paired Android STO relay.
ALTER TABLE "DeviceTunnelBinding"
    ADD COLUMN "reconnectGeneration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastReconnectRequestId" TEXT,
    ADD COLUMN "lastReconnectRequestedAt" TIMESTAMP(3),
    ADD COLUMN "lastReconnectAttemptedAt" TIMESTAMP(3),
    ADD COLUMN "lastReconnectErrorCode" TEXT,
    ADD COLUMN "lastDeviceRuntimeState" TEXT,
    ADD COLUMN "batteryOptimizationIgnored" BOOLEAN;
