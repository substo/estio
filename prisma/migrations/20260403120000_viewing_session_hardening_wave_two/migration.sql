ALTER TABLE "SearchConfig"
ADD COLUMN "viewingSessionAiDisclosureVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN "viewingSessionTranslationModel" TEXT,
ADD COLUMN "viewingSessionInsightsModel" TEXT,
ADD COLUMN "viewingSessionSummaryModel" TEXT;

ALTER TABLE "ViewingSession"
ADD COLUMN "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN "consentVersion" TEXT,
ADD COLUMN "consentLocale" TEXT,
ADD COLUMN "consentSource" TEXT,
ADD COLUMN "translationModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
ADD COLUMN "insightsModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
ADD COLUMN "summaryModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash';

UPDATE "ViewingSession"
SET
    "consentAcceptedAt" = COALESCE("consentAcceptedAt", "lastJoinedAt"),
    "consentVersion" = COALESCE("consentVersion", 'v1'),
    "consentLocale" = COALESCE("consentLocale", "clientLanguage"),
    "consentSource" = COALESCE("consentSource", 'join_form')
WHERE "consentStatus" = 'accepted';

ALTER TABLE "ViewingSessionMessage"
ADD COLUMN "utteranceId" TEXT;

UPDATE "ViewingSessionMessage"
SET "utteranceId" = "id"
WHERE "utteranceId" IS NULL;

WITH RECURSIVE "MessageLineage" AS (
    SELECT
        m."id",
        m."supersedesMessageId",
        m."id" AS "rootId"
    FROM "ViewingSessionMessage" m
    WHERE m."supersedesMessageId" IS NULL

    UNION ALL

    SELECT
        child."id",
        child."supersedesMessageId",
        lineage."rootId"
    FROM "ViewingSessionMessage" child
    INNER JOIN "MessageLineage" lineage
        ON child."supersedesMessageId" = lineage."id"
)
UPDATE "ViewingSessionMessage" m
SET "utteranceId" = lineage."rootId"
FROM "MessageLineage" lineage
WHERE m."id" = lineage."id"
  AND (m."utteranceId" IS NULL OR m."utteranceId" <> lineage."rootId");

UPDATE "ViewingSessionMessage"
SET "utteranceId" = "id"
WHERE "utteranceId" IS NULL;

ALTER TABLE "ViewingSessionMessage"
ALTER COLUMN "utteranceId" SET NOT NULL;

ALTER TABLE "ViewingSessionInsight"
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "generationKey" TEXT;

ALTER TABLE "ViewingSessionUsage"
ADD COLUMN "usageAuthority" TEXT NOT NULL DEFAULT 'derived',
ADD COLUMN "costAuthority" TEXT NOT NULL DEFAULT 'estimated';

UPDATE "ViewingSessionUsage"
SET "usageAuthority" = 'provider_reported'
WHERE "phase" = 'live_audio';

CREATE INDEX "ViewingSessionMessage_sessionId_utteranceId_timestamp_idx"
ON "ViewingSessionMessage"("sessionId", "utteranceId", "timestamp");

CREATE INDEX "ViewingSessionInsight_sessionId_supersededAt_state_createdAt_idx"
ON "ViewingSessionInsight"("sessionId", "supersededAt", "state", "createdAt" DESC);

CREATE INDEX "ViewingSessionInsight_messageId_supersededAt_type_idx"
ON "ViewingSessionInsight"("messageId", "supersededAt", "type");
