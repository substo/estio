-- Distributed WhatsApp rate-limit policy, user-visible deferral metadata, and
-- a PostgreSQL dispatch lock that backs up Redis session serialization.
ALTER TABLE "WhatsAppOutboundOutbox"
    ADD COLUMN "rateLimitReason" TEXT,
    ADD COLUMN "rateLimitNextEligibleAt" TIMESTAMP(3);

CREATE TABLE "WhatsAppRateLimitPolicy" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trustTier" TEXT NOT NULL DEFAULT 'new',
    "limits" JSONB,
    "metadata" JSONB,

    CONSTRAINT "WhatsAppRateLimitPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppRateLimitPolicy_trustTier_check" CHECK ("trustTier" IN ('new', 'established', 'reviewed'))
);

CREATE TABLE "WhatsAppOutboundDispatchLock" (
    "scopeKey" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppOutboundDispatchLock_pkey" PRIMARY KEY ("scopeKey")
);

CREATE UNIQUE INDEX "WhatsAppRateLimitPolicy_locationId_key" ON "WhatsAppRateLimitPolicy"("locationId");
CREATE INDEX "WhatsAppRateLimitPolicy_enabled_trustTier_idx" ON "WhatsAppRateLimitPolicy"("enabled", "trustTier");
CREATE INDEX "WhatsAppOutboundDispatchLock_locationId_expiresAt_idx" ON "WhatsAppOutboundDispatchLock"("locationId", "expiresAt");
CREATE INDEX "WhatsAppOutboundDispatchLock_expiresAt_idx" ON "WhatsAppOutboundDispatchLock"("expiresAt");

ALTER TABLE "WhatsAppRateLimitPolicy"
    ADD CONSTRAINT "WhatsAppRateLimitPolicy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppOutboundDispatchLock"
    ADD CONSTRAINT "WhatsAppOutboundDispatchLock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
