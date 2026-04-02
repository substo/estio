-- AlterTable
ALTER TABLE "ViewingSession"
ADD COLUMN "sessionThreadId" TEXT;

-- Backfill stable session thread id for existing chains.
-- Root sessions use their own id; chained sessions inherit the root id.
WITH RECURSIVE chain AS (
    SELECT
        s."id",
        s."previousSessionId",
        s."id" AS "rootId"
    FROM "ViewingSession" s
    WHERE s."previousSessionId" IS NULL

    UNION ALL

    SELECT
        child."id",
        child."previousSessionId",
        chain."rootId"
    FROM "ViewingSession" child
    INNER JOIN chain ON child."previousSessionId" = chain."id"
)
UPDATE "ViewingSession" s
SET "sessionThreadId" = chain."rootId"
FROM chain
WHERE s."id" = chain."id";

-- Fallback for any orphaned rows.
UPDATE "ViewingSession"
SET "sessionThreadId" = "id"
WHERE "sessionThreadId" IS NULL;

ALTER TABLE "ViewingSession"
ALTER COLUMN "sessionThreadId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ViewingSessionMessage"
ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual_text',
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "modelVersion" TEXT,
ADD COLUMN "transcriptStatus" TEXT NOT NULL DEFAULT 'final',
ADD COLUMN "translationStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "insightStatus" TEXT NOT NULL DEFAULT 'pending';

-- Backfill pipeline/provenance fields from legacy analysisStatus.
UPDATE "ViewingSessionMessage"
SET
    "origin" = CASE
        WHEN "messageKind" = 'tool_result' THEN 'relay_tool_result'
        ELSE 'manual_text'
    END,
    "translationStatus" = CASE
        WHEN "analysisStatus" = 'completed' AND COALESCE("translatedText", '') <> '' THEN 'completed'
        WHEN "analysisStatus" = 'failed' THEN 'failed'
        ELSE 'pending'
    END,
    "insightStatus" = CASE
        WHEN "analysisStatus" = 'completed' THEN 'completed'
        WHEN "analysisStatus" = 'failed' THEN 'failed'
        ELSE 'pending'
    END
WHERE 1 = 1;

-- AlterTable
ALTER TABLE "ViewingSessionInsight"
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "modelVersion" TEXT;

ALTER TABLE "ViewingSessionInsight"
ALTER COLUMN "source" SET DEFAULT 'analysis_model';

UPDATE "ViewingSessionInsight"
SET "source" = 'analysis_model'
WHERE "source" = 'model';

-- AlterTable
ALTER TABLE "ViewingSessionSummary"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'analysis_model',
ADD COLUMN "modelVersion" TEXT,
ADD COLUMN "usedFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "generatedByUserId" TEXT;

-- Preserve current semantics for legacy rows.
UPDATE "ViewingSessionSummary"
SET "source" = CASE
    WHEN "provider" IS NULL AND "model" IS NULL THEN 'heuristic_fallback'
    ELSE 'analysis_model'
END
WHERE 1 = 1;

-- CreateIndex
CREATE INDEX "ViewingSession_sessionThreadId_createdAt_idx" ON "ViewingSession"("sessionThreadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_translationStatus_createdAt_idx" ON "ViewingSessionMessage"("translationStatus", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ViewingSessionMessage_insightStatus_createdAt_idx" ON "ViewingSessionMessage"("insightStatus", "createdAt" ASC);
