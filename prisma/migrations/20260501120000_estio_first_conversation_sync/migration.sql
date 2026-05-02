-- Estio-first provider sync layer for conversations and messages.
-- The local Conversation.id remains canonical; provider IDs are mirrored here.

CREATE TABLE "ConversationSync" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL DEFAULT 'default',
    "providerConversationId" TEXT,
    "providerThreadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remoteUpdatedAt" TIMESTAMP(3),
    "syncCursor" TEXT,
    "syncToken" TEXT,
    "etag" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ConversationSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageSync" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL DEFAULT 'default',
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remoteUpdatedAt" TIMESTAMP(3),
    "etag" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,

    CONSTRAINT "MessageSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderOutbox" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "contactId" TEXT,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL DEFAULT 'default',
    "operation" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "ProviderOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationSync_conversationId_provider_providerAccountId_key"
ON "ConversationSync" ("conversationId", "provider", "providerAccountId");

CREATE UNIQUE INDEX "ConversationSync_provider_providerAccountId_providerConversationId_key"
ON "ConversationSync" ("provider", "providerAccountId", "providerConversationId");

CREATE INDEX "ConversationSync_locationId_provider_status_lastSyncedAt_idx"
ON "ConversationSync" ("locationId", "provider", "status", "lastSyncedAt");

CREATE INDEX "ConversationSync_provider_status_lastAttemptAt_idx"
ON "ConversationSync" ("provider", "status", "lastAttemptAt");

CREATE UNIQUE INDEX "MessageSync_messageId_provider_providerAccountId_key"
ON "MessageSync" ("messageId", "provider", "providerAccountId");

CREATE UNIQUE INDEX "MessageSync_provider_providerAccountId_providerMessageId_key"
ON "MessageSync" ("provider", "providerAccountId", "providerMessageId");

CREATE INDEX "MessageSync_conversationId_provider_status_idx"
ON "MessageSync" ("conversationId", "provider", "status");

CREATE INDEX "MessageSync_locationId_provider_status_lastSyncedAt_idx"
ON "MessageSync" ("locationId", "provider", "status", "lastSyncedAt");

CREATE UNIQUE INDEX "ProviderOutbox_idempotencyKey_key"
ON "ProviderOutbox" ("idempotencyKey");

CREATE INDEX "ProviderOutbox_provider_status_scheduledAt_idx"
ON "ProviderOutbox" ("provider", "status", "scheduledAt");

CREATE INDEX "ProviderOutbox_locationId_provider_status_scheduledAt_idx"
ON "ProviderOutbox" ("locationId", "provider", "status", "scheduledAt");

CREATE INDEX "ProviderOutbox_conversationId_provider_status_idx"
ON "ProviderOutbox" ("conversationId", "provider", "status");

CREATE INDEX "ProviderOutbox_messageId_provider_status_idx"
ON "ProviderOutbox" ("messageId", "provider", "status");

ALTER TABLE "ConversationSync"
ADD CONSTRAINT "ConversationSync_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationSync"
ADD CONSTRAINT "ConversationSync_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageSync"
ADD CONSTRAINT "MessageSync_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageSync"
ADD CONSTRAINT "MessageSync_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageSync"
ADD CONSTRAINT "MessageSync_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderOutbox"
ADD CONSTRAINT "ProviderOutbox_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderOutbox"
ADD CONSTRAINT "ProviderOutbox_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderOutbox"
ADD CONSTRAINT "ProviderOutbox_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderOutbox"
ADD CONSTRAINT "ProviderOutbox_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill true-looking GHL conversation IDs only. Synthetic Estio-local aliases
-- remain legacy aliases in Conversation.ghlConversationId for compatibility.
INSERT INTO "ConversationSync" (
    "id",
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
    'csync_' || md5(c."id" || ':ghl'),
    c."id",
    c."locationId",
    'ghl',
    COALESCE(l."ghlLocationId", 'default'),
    c."ghlConversationId",
    'synced',
    CURRENT_TIMESTAMP,
    jsonb_build_object('backfilledFrom', 'Conversation.ghlConversationId')
FROM "Conversation" c
JOIN "Location" l ON l."id" = c."locationId"
WHERE c."ghlConversationId" ~ '^[A-Za-z0-9]{20,}$'
  AND c."ghlConversationId" NOT LIKE 'wa_%'
  AND c."ghlConversationId" NOT LIKE 'import_%'
  AND c."ghlConversationId" NOT LIKE 'native-%'
  AND c."ghlConversationId" NOT LIKE 'owa_%'
ON CONFLICT DO NOTHING;

INSERT INTO "ConversationSync" (
    "id",
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
    'csync_' || md5(c."id" || ':evolution'),
    c."id",
    c."locationId",
    'evolution',
    COALESCE(l."evolutionInstanceId", 'default'),
    c."ghlConversationId",
    'synced',
    CURRENT_TIMESTAMP,
    jsonb_build_object('backfilledFrom', 'Conversation.ghlConversationId')
FROM "Conversation" c
JOIN "Location" l ON l."id" = c."locationId"
WHERE c."ghlConversationId" LIKE 'wa_%'
ON CONFLICT DO NOTHING;

INSERT INTO "MessageSync" (
    "id",
    "messageId",
    "conversationId",
    "locationId",
    "provider",
    "providerAccountId",
    "providerMessageId",
    "providerThreadId",
    "status",
    "lastSyncedAt",
    "metadata"
)
SELECT
    'msync_' || md5(m."id" || ':evolution'),
    m."id",
    m."conversationId",
    c."locationId",
    'evolution',
    COALESCE(l."evolutionInstanceId", 'default'),
    m."wamId",
    c."ghlConversationId",
    'synced',
    CURRENT_TIMESTAMP,
    jsonb_build_object('backfilledFrom', 'Message.wamId')
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
JOIN "Location" l ON l."id" = c."locationId"
WHERE m."wamId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "MessageSync" (
    "id",
    "messageId",
    "conversationId",
    "locationId",
    "provider",
    "providerAccountId",
    "providerMessageId",
    "providerThreadId",
    "status",
    "lastSyncedAt",
    "metadata"
)
SELECT
    'msync_' || md5(m."id" || ':google'),
    m."id",
    m."conversationId",
    c."locationId",
    'google',
    COALESCE(m."emailFrom", 'default'),
    m."emailMessageId",
    m."emailThreadId",
    'synced',
    CURRENT_TIMESTAMP,
    jsonb_build_object('backfilledFrom', 'Message.emailMessageId')
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
WHERE m."emailMessageId" IS NOT NULL
  AND (m."source" = 'GMAIL_SYNC' OR m."source" IS NULL)
ON CONFLICT DO NOTHING;
