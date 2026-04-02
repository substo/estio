-- AlterTable
ALTER TABLE "SearchConfig"
ADD COLUMN "viewingSessionRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "viewingSessionTranscriptVisibility" TEXT NOT NULL DEFAULT 'team',
ADD COLUMN "viewingSessionAiDisclosureRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "viewingSessionRawAudioStorageEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ViewingSession"
ADD COLUMN "transportStatus" TEXT NOT NULL DEFAULT 'disconnected',
ADD COLUMN "liveProvider" TEXT NOT NULL DEFAULT 'google_gemini_live',
ADD COLUMN "consentStatus" TEXT NOT NULL DEFAULT 'required',
ADD COLUMN "appliedRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "transcriptVisibility" TEXT NOT NULL DEFAULT 'team',
ADD COLUMN "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "actualCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "lastTransportEventAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ViewingSessionMessage"
ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "sourceMessageId" TEXT,
ADD COLUMN "messageKind" TEXT NOT NULL DEFAULT 'utterance',
ADD COLUMN "persistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "supersedesMessageId" TEXT;

-- Data backfill for existing messages so `(sessionId, sequence)` can be made unique safely.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY "sessionId"
            ORDER BY "timestamp" ASC, "createdAt" ASC, id ASC
        ) AS next_seq
    FROM "ViewingSessionMessage"
)
UPDATE "ViewingSessionMessage" m
SET "sequence" = ranked.next_seq
FROM ranked
WHERE m.id = ranked.id;

-- CreateTable
CREATE TABLE "ViewingSessionEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorRole" TEXT,
    "actorUserId" TEXT,
    "source" TEXT,
    "payload" JSONB,

    CONSTRAINT "ViewingSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingSessionUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "transportStatus" TEXT,
    "inputAudioSeconds" DOUBLE PRECISION DEFAULT 0,
    "outputAudioSeconds" DOUBLE PRECISION DEFAULT 0,
    "inputTokens" INTEGER DEFAULT 0,
    "outputTokens" INTEGER DEFAULT 0,
    "totalTokens" INTEGER DEFAULT 0,
    "toolCalls" INTEGER DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION DEFAULT 0,
    "actualCostUsd" DOUBLE PRECISION DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "ViewingSessionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViewingSession_transportStatus_createdAt_idx" ON "ViewingSession"("transportStatus", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSession_liveProvider_createdAt_idx" ON "ViewingSession"("liveProvider", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_sessionId_sequence_idx" ON "ViewingSessionMessage"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_sessionId_sourceMessageId_idx" ON "ViewingSessionMessage"("sessionId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_supersedesMessageId_idx" ON "ViewingSessionMessage"("supersedesMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewingSessionMessage_sessionId_sequence_key" ON "ViewingSessionMessage"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ViewingSessionMessage_sessionId_sourceMessageId_key" ON "ViewingSessionMessage"("sessionId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "ViewingSessionEvent_sessionId_createdAt_idx" ON "ViewingSessionEvent"("sessionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionEvent_locationId_createdAt_idx" ON "ViewingSessionEvent"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionEvent_type_createdAt_idx" ON "ViewingSessionEvent"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionUsage_sessionId_recordedAt_idx" ON "ViewingSessionUsage"("sessionId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionUsage_locationId_recordedAt_idx" ON "ViewingSessionUsage"("locationId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionUsage_phase_recordedAt_idx" ON "ViewingSessionUsage"("phase", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "ViewingSessionMessage" ADD CONSTRAINT "ViewingSessionMessage_supersedesMessageId_fkey"
FOREIGN KEY ("supersedesMessageId") REFERENCES "ViewingSessionMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionEvent" ADD CONSTRAINT "ViewingSessionEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "ViewingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionEvent" ADD CONSTRAINT "ViewingSessionEvent_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionUsage" ADD CONSTRAINT "ViewingSessionUsage_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "ViewingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingSessionUsage" ADD CONSTRAINT "ViewingSessionUsage_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
