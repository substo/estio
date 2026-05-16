UPDATE "Location"
SET "whatsappProviderMode" = 'web_bridge'
WHERE "whatsappProviderMode" = 'evolution_linked';

ALTER TABLE "Location"
DROP COLUMN IF EXISTS "evolutionInstanceId",
DROP COLUMN IF EXISTS "evolutionApiToken",
DROP COLUMN IF EXISTS "evolutionConnectionStatus";
