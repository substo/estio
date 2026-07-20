-- Durable WhatsApp session-auth placement metadata. Profile contents remain in
-- encrypted immutable object generations and are never stored in PostgreSQL.
CREATE TABLE "WhatsAppSessionAuthPlacement" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'r2_encrypted_snapshot',
    "state" TEXT NOT NULL DEFAULT 'detached',
    "gatewayNodeId" TEXT,
    "assignmentEpoch" INTEGER NOT NULL DEFAULT 0,
    "ownerInstanceId" TEXT,
    "leaseEpoch" INTEGER NOT NULL DEFAULT 0,
    "authEpoch" INTEGER NOT NULL DEFAULT 0,
    "operationId" TEXT,
    "operationStartedAt" TIMESTAMP(3),
    "operationDeadlineAt" TIMESTAMP(3),
    "currentGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastKnownGoodGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastAttachedAt" TIMESTAMP(3),
    "lastDetachedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "recoveryStatus" TEXT NOT NULL DEFAULT 'healthy',
    "lastErrorCode" TEXT,

    CONSTRAINT "WhatsAppSessionAuthPlacement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppSessionAuthPlacement_provider_check" CHECK ("provider" = 'r2_encrypted_snapshot'),
    CONSTRAINT "WhatsAppSessionAuthPlacement_state_check" CHECK ("state" IN ('detached', 'attaching', 'attached', 'detaching', 'recovering', 'quarantined', 'relink_required')),
    CONSTRAINT "WhatsAppSessionAuthPlacement_recoveryStatus_check" CHECK ("recoveryStatus" IN ('healthy', 'restoring_previous', 'quarantined', 'relink_required')),
    CONSTRAINT "WhatsAppSessionAuthPlacement_epochs_check" CHECK ("assignmentEpoch" >= 0 AND "leaseEpoch" >= 0 AND "authEpoch" >= 0),
    CONSTRAINT "WhatsAppSessionAuthPlacement_generations_check" CHECK ("currentGeneration" >= 0 AND "lastKnownGoodGeneration" >= 0),
    CONSTRAINT "WhatsAppSessionAuthPlacement_operation_check" CHECK (
        ("state" IN ('attaching', 'detaching', 'recovering') AND "operationId" IS NOT NULL AND "operationStartedAt" IS NOT NULL AND "operationDeadlineAt" IS NOT NULL)
        OR
        ("state" NOT IN ('attaching', 'detaching', 'recovering') AND "operationId" IS NULL AND "operationStartedAt" IS NULL AND "operationDeadlineAt" IS NULL)
    ),
    CONSTRAINT "WhatsAppSessionAuthPlacement_owner_scope_check" CHECK (
        ("state" IN ('attaching', 'attached', 'detaching', 'recovering') AND "gatewayNodeId" IS NOT NULL AND "ownerInstanceId" IS NOT NULL AND "assignmentEpoch" > 0 AND "leaseEpoch" > 0 AND "authEpoch" > 0)
        OR
        ("state" IN ('detached', 'quarantined', 'relink_required') AND "gatewayNodeId" IS NULL AND "ownerInstanceId" IS NULL AND "leaseEpoch" = 0)
    )
);

CREATE TABLE "WhatsAppSessionAuthGeneration" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "placementId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "authEpoch" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "objectKey" TEXT NOT NULL,
    "objectVersionId" TEXT,
    "objectEtag" TEXT,
    "encryptedSize" BIGINT NOT NULL,
    "plaintextSize" BIGINT NOT NULL,
    "ciphertextSha256" TEXT NOT NULL,
    "plaintextSha256" TEXT NOT NULL,
    "encryptionAlgorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "kmsKeyName" TEXT NOT NULL,
    "encryptedDek" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "WhatsAppSessionAuthGeneration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppSessionAuthGeneration_generation_check" CHECK ("generation" > 0 AND "authEpoch" > 0),
    CONSTRAINT "WhatsAppSessionAuthGeneration_status_check" CHECK ("status" IN ('pending', 'verified', 'quarantined', 'retired', 'deleted')),
    CONSTRAINT "WhatsAppSessionAuthGeneration_size_check" CHECK ("encryptedSize" > 0 AND "plaintextSize" > 0),
    CONSTRAINT "WhatsAppSessionAuthGeneration_crypto_check" CHECK (
        "encryptionAlgorithm" = 'AES-256-GCM'
        AND "formatVersion" = 1
        AND char_length("ciphertextSha256") = 64
        AND char_length("plaintextSha256") = 64
        AND char_length("iv") BETWEEN 16 AND 32
        AND char_length("authTag") BETWEEN 20 AND 32
        AND char_length("encryptedDek") BETWEEN 16 AND 16384
    )
);

CREATE TABLE "WhatsAppSessionAuthAuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placementId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "gatewayNodeId" TEXT,
    "assignmentEpoch" INTEGER NOT NULL,
    "leaseEpoch" INTEGER NOT NULL,
    "authEpoch" INTEGER NOT NULL,
    "operationId" TEXT,
    "generation" INTEGER,
    "errorCode" TEXT,
    "metadata" JSONB,

    CONSTRAINT "WhatsAppSessionAuthAuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppSessionAuthAuditEvent_epochs_check" CHECK ("assignmentEpoch" >= 0 AND "leaseEpoch" >= 0 AND "authEpoch" >= 0),
    CONSTRAINT "WhatsAppSessionAuthAuditEvent_generation_check" CHECK ("generation" IS NULL OR "generation" > 0)
);

CREATE UNIQUE INDEX "WhatsAppSessionAuthPlacement_sessionId_key" ON "WhatsAppSessionAuthPlacement"("sessionId");
CREATE UNIQUE INDEX "WhatsAppSessionAuthPlacement_bindingId_key" ON "WhatsAppSessionAuthPlacement"("bindingId");
CREATE UNIQUE INDEX "WhatsAppSessionAuthPlacement_operationId_key" ON "WhatsAppSessionAuthPlacement"("operationId");
CREATE INDEX "WhatsAppSessionAuthPlacement_locationId_state_idx" ON "WhatsAppSessionAuthPlacement"("locationId", "state");
CREATE INDEX "WhatsAppSessionAuthPlacement_gatewayNodeId_state_idx" ON "WhatsAppSessionAuthPlacement"("gatewayNodeId", "state");
CREATE INDEX "WhatsAppSessionAuthPlacement_state_operationDeadlineAt_idx" ON "WhatsAppSessionAuthPlacement"("state", "operationDeadlineAt");

CREATE UNIQUE INDEX "WhatsAppSessionAuthGeneration_objectKey_key" ON "WhatsAppSessionAuthGeneration"("objectKey");
CREATE UNIQUE INDEX "WhatsAppSessionAuthGeneration_placementId_generation_key" ON "WhatsAppSessionAuthGeneration"("placementId", "generation");
CREATE INDEX "WhatsAppSessionAuthGeneration_sessionId_status_generation_idx" ON "WhatsAppSessionAuthGeneration"("sessionId", "status", "generation" DESC);
CREATE INDEX "WhatsAppSessionAuthGeneration_status_retentionUntil_idx" ON "WhatsAppSessionAuthGeneration"("status", "retentionUntil");

CREATE INDEX "WhatsAppSessionAuthAuditEvent_placementId_createdAt_idx" ON "WhatsAppSessionAuthAuditEvent"("placementId", "createdAt" DESC);
CREATE INDEX "WhatsAppSessionAuthAuditEvent_locationId_createdAt_idx" ON "WhatsAppSessionAuthAuditEvent"("locationId", "createdAt" DESC);
CREATE INDEX "WhatsAppSessionAuthAuditEvent_sessionId_createdAt_idx" ON "WhatsAppSessionAuthAuditEvent"("sessionId", "createdAt" DESC);
CREATE INDEX "WhatsAppSessionAuthAuditEvent_bindingId_createdAt_idx" ON "WhatsAppSessionAuthAuditEvent"("bindingId", "createdAt" DESC);

ALTER TABLE "WhatsAppSessionAuthPlacement"
    ADD CONSTRAINT "WhatsAppSessionAuthPlacement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthPlacement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppWebBridgeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthPlacement_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "DeviceTunnelBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthPlacement_gatewayNodeId_fkey" FOREIGN KEY ("gatewayNodeId") REFERENCES "DeviceTunnelGatewayNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsAppSessionAuthGeneration"
    ADD CONSTRAINT "WhatsAppSessionAuthGeneration_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "WhatsAppSessionAuthPlacement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthGeneration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppWebBridgeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppSessionAuthAuditEvent"
    ADD CONSTRAINT "WhatsAppSessionAuthAuditEvent_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "WhatsAppSessionAuthPlacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthAuditEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthAuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppWebBridgeSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthAuditEvent_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "DeviceTunnelBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "WhatsAppSessionAuthAuditEvent_gatewayNodeId_fkey" FOREIGN KEY ("gatewayNodeId") REFERENCES "DeviceTunnelGatewayNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_whatsapp_session_auth_audit_mutation"()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WhatsApp session-auth audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WhatsAppSessionAuthAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "WhatsAppSessionAuthAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_whatsapp_session_auth_audit_mutation"();
