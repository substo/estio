-- First-class WhatsApp Cloud API phone numbers per location.

CREATE TABLE IF NOT EXISTS "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "providerMode" TEXT NOT NULL DEFAULT 'cloud_primary',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "qualityRating" TEXT,
    "platformType" TEXT,
    "isDefaultOutbound" BOOLEAN NOT NULL DEFAULT false,
    "coexistenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthCheckedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppChannel_phoneNumberId_key"
ON "WhatsAppChannel"("phoneNumberId");

CREATE INDEX IF NOT EXISTS "WhatsAppChannel_locationId_isDefaultOutbound_idx"
ON "WhatsAppChannel"("locationId", "isDefaultOutbound");

CREATE INDEX IF NOT EXISTS "WhatsAppChannel_locationId_wabaId_idx"
ON "WhatsAppChannel"("locationId", "wabaId");

CREATE INDEX IF NOT EXISTS "WhatsAppChannel_status_idx"
ON "WhatsAppChannel"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'WhatsAppChannel_locationId_fkey'
    ) THEN
        ALTER TABLE "WhatsAppChannel"
        ADD CONSTRAINT "WhatsAppChannel_locationId_fkey"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

INSERT INTO "WhatsAppChannel" (
    "id",
    "createdAt",
    "updatedAt",
    "locationId",
    "wabaId",
    "phoneNumberId",
    "providerMode",
    "status",
    "isDefaultOutbound",
    "coexistenceEnabled",
    "metadata"
)
SELECT
    'wach_' || md5("id" || ':' || "whatsappPhoneNumberId"),
    NOW(),
    NOW(),
    "id",
    COALESCE("whatsappBusinessAccountId", ''),
    "whatsappPhoneNumberId",
    COALESCE("whatsappProviderMode", 'cloud_primary'),
    'legacy_imported',
    true,
    false,
    jsonb_build_object('source', 'legacy_location_columns')
FROM "Location"
WHERE "whatsappPhoneNumberId" IS NOT NULL
  AND trim("whatsappPhoneNumberId") <> ''
ON CONFLICT ("phoneNumberId") DO NOTHING;
