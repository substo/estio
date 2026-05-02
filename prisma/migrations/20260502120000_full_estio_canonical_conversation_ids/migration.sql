-- Full Estio-canonical conversation ID migration.
-- Conversation.id is canonical. ghlConversationId remains as a nullable legacy/provider alias.

ALTER TABLE "Conversation"
ALTER COLUMN "ghlConversationId" DROP NOT NULL;

CREATE TABLE "DealConversationLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dealId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "legacyConversationRef" TEXT,

    CONSTRAINT "DealConversationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealConversationLink_dealId_conversationId_key"
ON "DealConversationLink" ("dealId", "conversationId");

CREATE INDEX "DealConversationLink_conversationId_idx"
ON "DealConversationLink" ("conversationId");

CREATE INDEX "DealConversationLink_legacyConversationRef_idx"
ON "DealConversationLink" ("legacyConversationRef");

ALTER TABLE "DealConversationLink"
ADD CONSTRAINT "DealConversationLink_dealId_fkey"
FOREIGN KEY ("dealId") REFERENCES "DealContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealConversationLink"
ADD CONSTRAINT "DealConversationLink_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ConversationSync" (
    "id",
    "createdAt",
    "updatedAt",
    "conversationId",
    "locationId",
    "provider",
    "providerAccountId",
    "providerConversationId",
    "status",
    "lastSyncedAt",
    "metadata"
)
SELECT
    'csync_' || md5(c."id" || ':legacy_alias:' || c."ghlConversationId"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    c."id",
    c."locationId",
    'estio_legacy_alias',
    'local',
    c."ghlConversationId",
    'synced',
    CURRENT_TIMESTAMP,
    jsonb_build_object('backfilledFrom', 'Conversation.ghlConversationId', 'migration', 'full_estio_canonical_conversation_ids')
FROM "Conversation" c
WHERE c."ghlConversationId" IS NOT NULL
  AND (
    c."ghlConversationId" LIKE 'wa_%'
    OR c."ghlConversationId" LIKE 'import_%'
    OR c."ghlConversationId" LIKE 'native-%'
    OR c."ghlConversationId" LIKE 'owa_%'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "DealConversationLink" (
    "id",
    "dealId",
    "conversationId",
    "legacyConversationRef"
)
SELECT
    'dcl_' || md5(d."id" || ':' || resolved."conversationId"),
    d."id",
    resolved."conversationId",
    refs."legacyRef"
FROM "DealContext" d
CROSS JOIN LATERAL unnest(d."conversationIds") AS refs("legacyRef")
JOIN LATERAL (
    SELECT c."id" AS "conversationId"
    FROM "Conversation" c
    WHERE c."locationId" = d."locationId"
      AND (
        c."id" = refs."legacyRef"
        OR c."ghlConversationId" = refs."legacyRef"
        OR EXISTS (
            SELECT 1
            FROM "ConversationSync" cs
            WHERE cs."conversationId" = c."id"
              AND cs."providerConversationId" = refs."legacyRef"
        )
      )
    ORDER BY
      CASE
        WHEN c."id" = refs."legacyRef" THEN 0
        WHEN c."ghlConversationId" = refs."legacyRef" THEN 1
        ELSE 2
      END,
      c."updatedAt" DESC
    LIMIT 1
) resolved ON TRUE
ON CONFLICT DO NOTHING;
