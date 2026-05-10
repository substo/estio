-- Enterprise WhatsApp template draft/review metadata.

ALTER TABLE "WhatsAppTemplate"
ADD COLUMN IF NOT EXISTS "bodyText" TEXT,
ADD COLUMN IF NOT EXISTS "header" JSONB,
ADD COLUMN IF NOT EXISTS "footer" TEXT,
ADD COLUMN IF NOT EXISTS "buttons" JSONB,
ADD COLUMN IF NOT EXISTS "aiPrompt" TEXT,
ADD COLUMN IF NOT EXISTS "aiRiskNotes" JSONB,
ADD COLUMN IF NOT EXISTS "localStatus" TEXT NOT NULL DEFAULT 'synced';

CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_locationId_localStatus_idx"
ON "WhatsAppTemplate"("locationId", "localStatus");
