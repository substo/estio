CREATE TABLE "MessageTranslationCache" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "detectedSourceLanguage" TEXT,
    "detectionConfidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "provider" TEXT,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTranslationCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTranslationCache_messageId_targetLanguage_sourceHash_key"
    ON "MessageTranslationCache"("messageId", "targetLanguage", "sourceHash");

CREATE INDEX "MessageTranslationCache_messageId_targetLanguage_updatedAt_idx"
    ON "MessageTranslationCache"("messageId", "targetLanguage", "updatedAt" DESC);

CREATE INDEX "MessageTranslationCache_conversationId_updatedAt_idx"
    ON "MessageTranslationCache"("conversationId", "updatedAt" DESC);

CREATE INDEX "MessageTranslationCache_locationId_updatedAt_idx"
    ON "MessageTranslationCache"("locationId", "updatedAt" DESC);

ALTER TABLE "MessageTranslationCache"
    ADD CONSTRAINT "MessageTranslationCache_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageTranslationCache"
    ADD CONSTRAINT "MessageTranslationCache_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageTranslationCache"
    ADD CONSTRAINT "MessageTranslationCache_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
