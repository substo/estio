-- Unified AI Automation Hub (V1)

CREATE TABLE "AiAutomationSchedule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'AI Automation',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "cadenceMinutes" INTEGER NOT NULL DEFAULT 30,
  "triggerType" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "quietHours" JSONB,
  "policy" JSONB,
  "nextRunAt" TIMESTAMP(3),
  "lastPlannedAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),

  CONSTRAINT "AiAutomationSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAutomationJob" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "conversationId" TEXT,
  "contactId" TEXT,
  "dealId" TEXT,
  "templateKey" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 6,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "sourceKey" TEXT,
  "traceId" TEXT,

  CONSTRAINT "AiAutomationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiSuggestedResponse" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "dealId" TEXT,
  "jobId" TEXT,
  "body" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "metadata" JSONB,
  "traceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "acceptedByUserId" TEXT,
  "rejectedByUserId" TEXT,

  CONSTRAINT "AiSuggestedResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAutomationJob_idempotencyKey_key" ON "AiAutomationJob"("idempotencyKey");
CREATE UNIQUE INDEX "AiSuggestedResponse_idempotencyKey_key" ON "AiSuggestedResponse"("idempotencyKey");

CREATE INDEX "AiAutomationSchedule_locationId_enabled_idx" ON "AiAutomationSchedule"("locationId", "enabled");
CREATE INDEX "AiAutomationSchedule_enabled_nextRunAt_idx" ON "AiAutomationSchedule"("enabled", "nextRunAt");
CREATE INDEX "AiAutomationSchedule_locationId_triggerType_templateKey_idx" ON "AiAutomationSchedule"("locationId", "triggerType", "templateKey");
CREATE UNIQUE INDEX "AiAutomationSchedule_locationId_triggerType_templateKey_key" ON "AiAutomationSchedule"("locationId", "triggerType", "templateKey");

CREATE INDEX "AiAutomationJob_status_scheduledAt_idx" ON "AiAutomationJob"("status", "scheduledAt");
CREATE INDEX "AiAutomationJob_locationId_status_scheduledAt_idx" ON "AiAutomationJob"("locationId", "status", "scheduledAt");
CREATE INDEX "AiAutomationJob_scheduleId_status_scheduledAt_idx" ON "AiAutomationJob"("scheduleId", "status", "scheduledAt");
CREATE INDEX "AiAutomationJob_conversationId_status_scheduledAt_idx" ON "AiAutomationJob"("conversationId", "status", "scheduledAt");
CREATE INDEX "AiAutomationJob_contactId_status_scheduledAt_idx" ON "AiAutomationJob"("contactId", "status", "scheduledAt");

CREATE INDEX "AiSuggestedResponse_locationId_status_createdAt_idx" ON "AiSuggestedResponse"("locationId", "status", "createdAt" DESC);
CREATE INDEX "AiSuggestedResponse_conversationId_status_createdAt_idx" ON "AiSuggestedResponse"("conversationId", "status", "createdAt" DESC);
CREATE INDEX "AiSuggestedResponse_dealId_status_createdAt_idx" ON "AiSuggestedResponse"("dealId", "status", "createdAt" DESC);
CREATE INDEX "AiSuggestedResponse_contactId_status_createdAt_idx" ON "AiSuggestedResponse"("contactId", "status", "createdAt" DESC);

ALTER TABLE "AiAutomationSchedule"
  ADD CONSTRAINT "AiAutomationSchedule_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAutomationJob"
  ADD CONSTRAINT "AiAutomationJob_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAutomationJob"
  ADD CONSTRAINT "AiAutomationJob_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "AiAutomationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiAutomationJob"
  ADD CONSTRAINT "AiAutomationJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiAutomationJob"
  ADD CONSTRAINT "AiAutomationJob_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AiAutomationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSuggestedResponse"
  ADD CONSTRAINT "AiSuggestedResponse_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
