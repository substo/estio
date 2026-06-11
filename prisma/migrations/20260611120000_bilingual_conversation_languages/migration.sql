-- Contact language profile and conversation-current language support.
ALTER TABLE "Conversation"
ADD COLUMN "currentLanguage" TEXT,
ADD COLUMN "currentLanguageSource" TEXT,
ADD COLUMN "currentLanguageConfidence" DOUBLE PRECISION,
ADD COLUMN "currentLanguageUpdatedAt" TIMESTAMP(3);

CREATE TABLE "ContactLanguage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'detected',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactLanguage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactLanguage_contactId_language_key" ON "ContactLanguage"("contactId", "language");
CREATE INDEX "ContactLanguage_locationId_language_idx" ON "ContactLanguage"("locationId", "language");
CREATE INDEX "ContactLanguage_contactId_lastSeenAt_idx" ON "ContactLanguage"("contactId", "lastSeenAt");

ALTER TABLE "ContactLanguage"
ADD CONSTRAINT "ContactLanguage_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
