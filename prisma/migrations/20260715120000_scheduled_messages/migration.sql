CREATE TABLE "ScheduledMessage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "source" TEXT NOT NULL DEFAULT 'composer',
  "metadata" JSONB,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "scheduledTimeZone" TEXT,
  "scheduledLocal" TEXT,
  "reviewRecommended" BOOLEAN NOT NULL DEFAULT false,
  "reviewReason" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "createdByUserId" TEXT,
  "sentAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "dispatchedMessageId" TEXT,

  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledMessage_status_scheduledFor_idx"
  ON "ScheduledMessage"("status", "scheduledFor");

CREATE INDEX "ScheduledMessage_locationId_status_scheduledFor_idx"
  ON "ScheduledMessage"("locationId", "status", "scheduledFor");

CREATE INDEX "ScheduledMessage_conversationId_status_scheduledFor_idx"
  ON "ScheduledMessage"("conversationId", "status", "scheduledFor");

CREATE INDEX "ScheduledMessage_contactId_status_scheduledFor_idx"
  ON "ScheduledMessage"("contactId", "status", "scheduledFor");

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_dispatchedMessageId_fkey"
  FOREIGN KEY ("dispatchedMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
