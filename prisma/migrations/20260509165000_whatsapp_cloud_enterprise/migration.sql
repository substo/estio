-- WhatsApp Business Cloud API enterprise support.

ALTER TABLE "Location"
ADD COLUMN IF NOT EXISTS "whatsappProviderMode" TEXT NOT NULL DEFAULT 'cloud_primary';

ALTER TABLE "Contact"
ADD COLUMN IF NOT EXISTS "whatsappLastInboundAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "whatsappCustomerServiceExpiresAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "components" JSONB NOT NULL,
    "parameterFormat" TEXT,
    "metaTemplateId" TEXT,
    "rejectionReason" TEXT,
    "variableLabels" JSONB,
    "examples" JSONB,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_locationId_name_language_key"
ON "WhatsAppTemplate"("locationId", "name", "language");

CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_locationId_status_idx"
ON "WhatsAppTemplate"("locationId", "status");

CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_locationId_category_status_idx"
ON "WhatsAppTemplate"("locationId", "category", "status");

CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_metaTemplateId_idx"
ON "WhatsAppTemplate"("metaTemplateId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'WhatsAppTemplate_locationId_fkey'
    ) THEN
        ALTER TABLE "WhatsAppTemplate"
        ADD CONSTRAINT "WhatsAppTemplate_locationId_fkey"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
