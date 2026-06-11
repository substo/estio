CREATE TABLE "ContactClassificationRun" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "model" TEXT NOT NULL,
  "totalQueued" INTEGER NOT NULL DEFAULT 0,
  "checked" INTEGER NOT NULL DEFAULT 0,
  "verified" INTEGER NOT NULL DEFAULT 0,
  "proposals" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "reprocessedCampaignBlocks" INTEGER NOT NULL DEFAULT 0,
  "requestedByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "pauseRequestedAt" TIMESTAMP(3),
  "cancelRequestedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "ContactClassificationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactClassificationRunItem" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "resultStatus" TEXT,
  "proposalId" TEXT,
  "lastError" TEXT,
  CONSTRAINT "ContactClassificationRunItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactClassificationRun_locationId_status_createdAt_idx"
  ON "ContactClassificationRun"("locationId", "status", "createdAt");

CREATE INDEX "ContactClassificationRun_status_createdAt_idx"
  ON "ContactClassificationRun"("status", "createdAt");

CREATE UNIQUE INDEX "ContactClassificationRunItem_runId_contactId_key"
  ON "ContactClassificationRunItem"("runId", "contactId");

CREATE INDEX "ContactClassificationRunItem_runId_status_createdAt_idx"
  ON "ContactClassificationRunItem"("runId", "status", "createdAt");

CREATE INDEX "ContactClassificationRunItem_locationId_status_createdAt_idx"
  ON "ContactClassificationRunItem"("locationId", "status", "createdAt");

CREATE INDEX "ContactClassificationRunItem_contactId_status_idx"
  ON "ContactClassificationRunItem"("contactId", "status");

ALTER TABLE "ContactClassificationRun"
  ADD CONSTRAINT "ContactClassificationRun_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactClassificationRunItem"
  ADD CONSTRAINT "ContactClassificationRunItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ContactClassificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactClassificationRunItem"
  ADD CONSTRAINT "ContactClassificationRunItem_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactClassificationRunItem"
  ADD CONSTRAINT "ContactClassificationRunItem_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
