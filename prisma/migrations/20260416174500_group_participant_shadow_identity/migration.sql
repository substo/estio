ALTER TABLE "ConversationParticipant"
    ADD COLUMN "identityKey" TEXT,
    ADD COLUMN "participantJid" TEXT,
    ADD COLUMN "lidJid" TEXT,
    ADD COLUMN "phoneJid" TEXT,
    ADD COLUMN "phoneDigits" TEXT,
    ADD COLUMN "displayName" TEXT,
    ADD COLUMN "lastSeenAt" TIMESTAMP(3),
    ADD COLUMN "resolutionConfidence" TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'whatsapp_evolution';

ALTER TABLE "ConversationParticipant"
    ALTER COLUMN "contactId" DROP NOT NULL;

UPDATE "ConversationParticipant" cp
SET
    "identityKey" = CONCAT('contact:', cp."contactId"),
    "displayName" = COALESCE(c."name", cp."displayName"),
    "phoneDigits" = NULLIF(regexp_replace(COALESCE(c."phone", ''), '\D', '', 'g'), '')
FROM "Contact" c
WHERE cp."contactId" = c."id"
  AND cp."identityKey" IS NULL;

UPDATE "ConversationParticipant"
SET "identityKey" = CONCAT('participant:', "id")
WHERE "identityKey" IS NULL;

ALTER TABLE "ConversationParticipant"
    ALTER COLUMN "identityKey" SET NOT NULL;

DROP INDEX IF EXISTS "ConversationParticipant_conversationId_contactId_key";

CREATE UNIQUE INDEX "ConversationParticipant_conversationId_identityKey_key"
    ON "ConversationParticipant"("conversationId", "identityKey");

CREATE INDEX "ConversationParticipant_lidJid_idx"
    ON "ConversationParticipant"("lidJid");

CREATE INDEX "ConversationParticipant_phoneDigits_idx"
    ON "ConversationParticipant"("phoneDigits");
