ALTER TABLE "GmailSyncState"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'synced',
ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE TABLE IF NOT EXISTS "GmailSyncOutbox" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
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

    CONSTRAINT "GmailSyncOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GmailSyncOutbox_idempotencyKey_key"
ON "GmailSyncOutbox" ("idempotencyKey");

CREATE INDEX IF NOT EXISTS "GmailSyncOutbox_status_scheduledAt_idx"
ON "GmailSyncOutbox" ("status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "GmailSyncOutbox_userId_status_scheduledAt_idx"
ON "GmailSyncOutbox" ("userId", "status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "GmailSyncOutbox_operation_status_scheduledAt_idx"
ON "GmailSyncOutbox" ("operation", "status", "scheduledAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'GmailSyncOutbox_userId_fkey'
    ) THEN
        ALTER TABLE "GmailSyncOutbox"
        ADD CONSTRAINT "GmailSyncOutbox_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
