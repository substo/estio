-- Durable WhatsApp identity mapping for Web Bridge LID-to-phone resolution.
CREATE TABLE "WhatsAppIdentityMap" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT,
    "provider" TEXT NOT NULL,
    "identityType" TEXT NOT NULL,
    "identityValue" TEXT NOT NULL,
    "lid" TEXT,
    "phone" TEXT,
    "displayName" TEXT,
    "confidence" TEXT,
    "source" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "WhatsAppIdentityMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppIdentityMap_locationId_provider_identityType_identityValue_key"
    ON "WhatsAppIdentityMap"("locationId", "provider", "identityType", "identityValue");

CREATE INDEX "WhatsAppIdentityMap_locationId_provider_identityType_idx"
    ON "WhatsAppIdentityMap"("locationId", "provider", "identityType");

CREATE INDEX "WhatsAppIdentityMap_locationId_phone_idx"
    ON "WhatsAppIdentityMap"("locationId", "phone");

CREATE INDEX "WhatsAppIdentityMap_locationId_lid_idx"
    ON "WhatsAppIdentityMap"("locationId", "lid");

CREATE INDEX "WhatsAppIdentityMap_contactId_idx"
    ON "WhatsAppIdentityMap"("contactId");

ALTER TABLE "WhatsAppIdentityMap"
    ADD CONSTRAINT "WhatsAppIdentityMap_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppIdentityMap"
    ADD CONSTRAINT "WhatsAppIdentityMap_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
