ALTER TABLE "WhatsAppCallAttempt" ALTER COLUMN "provider" SET DEFAULT 'meta_calling_api';

ALTER TABLE "WhatsAppCallBridgeConfig" RENAME TO "WhatsAppCallingConfig";
ALTER INDEX "WhatsAppCallBridgeConfig_locationId_key" RENAME TO "WhatsAppCallingConfig_locationId_key";

ALTER TABLE "WhatsAppCallingConfig" RENAME COLUMN "callingRuntimeMode" TO "provider";
ALTER TABLE "WhatsAppCallingConfig" RENAME COLUMN "baileysCallBridgeStatus" TO "status";
ALTER TABLE "WhatsAppCallingConfig" RENAME COLUMN "bridgeBaseUrl" TO "sipEndpoint";
ALTER TABLE "WhatsAppCallingConfig" RENAME COLUMN "mediaStatus" TO "mediaMode";

DROP INDEX IF EXISTS "WhatsAppCallBridgeConfig_baileysCallBridgeStatus_idx";
DROP INDEX IF EXISTS "WhatsAppCallBridgeConfig_mediaStatus_idx";

ALTER TABLE "WhatsAppCallingConfig" DROP COLUMN IF EXISTS "baileysSessionId";
ALTER TABLE "WhatsAppCallingConfig" DROP COLUMN IF EXISTS "lastBaileysHeartbeatAt";
ALTER TABLE "WhatsAppCallingConfig" ADD COLUMN "phoneNumberId" TEXT;
ALTER TABLE "WhatsAppCallingConfig" ADD COLUMN "wabaId" TEXT;
ALTER TABLE "WhatsAppCallingConfig" ADD COLUMN "callingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppCallingConfig" ADD COLUMN "webhooksEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "WhatsAppCallingConfig"
SET
  "provider" = 'meta_calling_api',
  "status" = CASE WHEN "status" = 'ready' THEN 'not_configured' ELSE 'not_configured' END,
  "mediaMode" = 'sip',
  "sipEndpoint" = NULL;

ALTER TABLE "WhatsAppCallingConfig" ALTER COLUMN "provider" SET DEFAULT 'meta_calling_api';
ALTER TABLE "WhatsAppCallingConfig" ALTER COLUMN "status" SET DEFAULT 'not_configured';
ALTER TABLE "WhatsAppCallingConfig" ALTER COLUMN "mediaMode" SET DEFAULT 'sip';

CREATE INDEX "WhatsAppCallingConfig_provider_idx" ON "WhatsAppCallingConfig"("provider");
CREATE INDEX "WhatsAppCallingConfig_status_idx" ON "WhatsAppCallingConfig"("status");
CREATE INDEX "WhatsAppCallingConfig_phoneNumberId_idx" ON "WhatsAppCallingConfig"("phoneNumberId");
CREATE INDEX "WhatsAppCallingConfig_mediaMode_idx" ON "WhatsAppCallingConfig"("mediaMode");

ALTER TABLE "WhatsAppCallingConfig" RENAME CONSTRAINT "WhatsAppCallBridgeConfig_pkey" TO "WhatsAppCallingConfig_pkey";
ALTER TABLE "WhatsAppCallingConfig" RENAME CONSTRAINT "WhatsAppCallBridgeConfig_locationId_fkey" TO "WhatsAppCallingConfig_locationId_fkey";
