-- CreateTable
CREATE TABLE "ViewingSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "viewingId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "primaryPropertyId" TEXT NOT NULL,
    "currentActivePropertyId" TEXT,
    "relatedPropertyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agentId" TEXT NOT NULL,
    "clientName" TEXT,
    "clientLanguage" TEXT,
    "agentLanguage" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'assistant_live_tool_heavy',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "sessionLinkTokenHash" TEXT NOT NULL,
    "pinCodeHash" TEXT NOT NULL,
    "pinCodeSalt" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "failedJoinAttempts" INTEGER NOT NULL DEFAULT 0,
    "joinLockUntil" TIMESTAMP(3),
    "lastJoinAttemptAt" TIMESTAMP(3),
    "lastJoinedAt" TIMESTAMP(3),
    "joinAudit" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "aiSummary" TEXT,
    "objections" JSONB,
    "keyPoints" JSONB,
    "recommendedNextActions" JSONB,
    "audioPlaybackClientEnabled" BOOLEAN NOT NULL DEFAULT false,
    "audioPlaybackAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "liveModel" TEXT,
    "contextVersion" INTEGER NOT NULL DEFAULT 1,
    "chainIndex" INTEGER NOT NULL DEFAULT 1,
    "previousSessionId" TEXT,
    "contextSnapshot" JSONB,

    CONSTRAINT "ViewingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingSessionMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "originalLanguage" TEXT,
    "translatedText" TEXT,
    "targetLanguage" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION,
    "audioChunkRef" TEXT,
    "analysisStatus" TEXT NOT NULL DEFAULT 'pending',
    "translatedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ViewingSessionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingSessionInsight" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "title" TEXT,
    "shortText" TEXT NOT NULL,
    "longText" TEXT,
    "confidence" DOUBLE PRECISION,
    "state" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'model',
    "metadata" JSONB,
    "pinnedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ViewingSessionInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingSessionSummary" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sessionSummary" TEXT,
    "crmNote" TEXT,
    "followUpWhatsApp" TEXT,
    "followUpEmail" TEXT,
    "translatedFollowUp" JSONB,
    "propertyComparisonDraft" TEXT,
    "recommendedNextActions" JSONB,
    "likes" JSONB,
    "dislikes" JSONB,
    "objections" JSONB,
    "buyingSignals" JSONB,
    "generatedAt" TIMESTAMP(3),
    "provider" TEXT DEFAULT 'google',
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,

    CONSTRAINT "ViewingSessionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewingSession_sessionLinkTokenHash_key" ON "ViewingSession"("sessionLinkTokenHash");

-- CreateIndex
CREATE INDEX "ViewingSession_locationId_status_createdAt_idx" ON "ViewingSession"("locationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSession_viewingId_createdAt_idx" ON "ViewingSession"("viewingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSession_contactId_createdAt_idx" ON "ViewingSession"("contactId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSession_agentId_status_createdAt_idx" ON "ViewingSession"("agentId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSession_tokenExpiresAt_idx" ON "ViewingSession"("tokenExpiresAt");

-- CreateIndex
CREATE INDEX "ViewingSession_joinLockUntil_idx" ON "ViewingSession"("joinLockUntil");

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_sessionId_timestamp_idx" ON "ViewingSessionMessage"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_sessionId_createdAt_idx" ON "ViewingSessionMessage"("sessionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_analysisStatus_createdAt_idx" ON "ViewingSessionMessage"("analysisStatus", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ViewingSessionInsight_sessionId_state_createdAt_idx" ON "ViewingSessionInsight"("sessionId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionInsight_sessionId_type_createdAt_idx" ON "ViewingSessionInsight"("sessionId", "type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionInsight_messageId_type_idx" ON "ViewingSessionInsight"("messageId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ViewingSessionSummary_sessionId_key" ON "ViewingSessionSummary"("sessionId");

-- CreateIndex
CREATE INDEX "ViewingSessionSummary_status_updatedAt_idx" ON "ViewingSessionSummary"("status", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "Viewing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_primaryPropertyId_fkey" FOREIGN KEY ("primaryPropertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_currentActivePropertyId_fkey" FOREIGN KEY ("currentActivePropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSession" ADD CONSTRAINT "ViewingSession_previousSessionId_fkey" FOREIGN KEY ("previousSessionId") REFERENCES "ViewingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionMessage" ADD CONSTRAINT "ViewingSessionMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ViewingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionInsight" ADD CONSTRAINT "ViewingSessionInsight_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ViewingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionInsight" ADD CONSTRAINT "ViewingSessionInsight_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ViewingSessionMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionSummary" ADD CONSTRAINT "ViewingSessionSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ViewingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
