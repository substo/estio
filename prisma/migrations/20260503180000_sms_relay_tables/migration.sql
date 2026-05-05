-- CreateTable: SmsRelayDevice
CREATE TABLE "SmsRelayDevice" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "status" TEXT NOT NULL DEFAULT 'offline',
    "pairTokenHash" TEXT,
    "paired" BOOLEAN NOT NULL DEFAULT false,
    "deviceApiTokenHash" TEXT,
    "devicePushToken" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsRelayDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SmsRelayOutbox
CREATE TABLE "SmsRelayOutbox" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "SmsRelayOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsRelayDevice_locationId_status_idx" ON "SmsRelayDevice"("locationId", "status");
CREATE INDEX "SmsRelayDevice_locationId_paired_idx" ON "SmsRelayDevice"("locationId", "paired");
CREATE INDEX "SmsRelayDevice_pairTokenHash_idx" ON "SmsRelayDevice"("pairTokenHash");

CREATE UNIQUE INDEX "SmsRelayOutbox_idempotencyKey_key" ON "SmsRelayOutbox"("idempotencyKey");
CREATE INDEX "SmsRelayOutbox_status_scheduledAt_idx" ON "SmsRelayOutbox"("status", "scheduledAt");
CREATE INDEX "SmsRelayOutbox_deviceId_status_idx" ON "SmsRelayOutbox"("deviceId", "status");
CREATE INDEX "SmsRelayOutbox_locationId_status_scheduledAt_idx" ON "SmsRelayOutbox"("locationId", "status", "scheduledAt");
CREATE INDEX "SmsRelayOutbox_messageId_idx" ON "SmsRelayOutbox"("messageId");

-- AddForeignKey
ALTER TABLE "SmsRelayDevice" ADD CONSTRAINT "SmsRelayDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsRelayOutbox" ADD CONSTRAINT "SmsRelayOutbox_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsRelayOutbox" ADD CONSTRAINT "SmsRelayOutbox_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "SmsRelayDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsRelayOutbox" ADD CONSTRAINT "SmsRelayOutbox_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsRelayOutbox" ADD CONSTRAINT "SmsRelayOutbox_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
