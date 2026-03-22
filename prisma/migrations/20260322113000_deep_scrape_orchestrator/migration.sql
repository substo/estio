-- Manual-first deep scrape orchestration + monitoring history

CREATE TABLE "DeepScrapeRun" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "locationId" TEXT NOT NULL,

  "status" TEXT NOT NULL DEFAULT 'running',
  "triggeredBy" TEXT,
  "triggeredByUserId" TEXT,
  "queueJobId" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorLog" TEXT,
  "configSnapshot" JSONB,
  "metadata" JSONB,

  "tasksScanned" INTEGER NOT NULL DEFAULT 0,
  "tasksStarted" INTEGER NOT NULL DEFAULT 0,
  "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
  "tasksSkipped" INTEGER NOT NULL DEFAULT 0,

  "rootUrlsProcessed" INTEGER NOT NULL DEFAULT 0,
  "indexPagesScraped" INTEGER NOT NULL DEFAULT 0,
  "seedListingsFound" INTEGER NOT NULL DEFAULT 0,
  "seedListingsNew" INTEGER NOT NULL DEFAULT 0,
  "seedListingsDuplicate" INTEGER NOT NULL DEFAULT 0,
  "prospectsCreated" INTEGER NOT NULL DEFAULT 0,
  "prospectsMatched" INTEGER NOT NULL DEFAULT 0,
  "contactsWithPhone" INTEGER NOT NULL DEFAULT 0,
  "contactsWithoutPhone" INTEGER NOT NULL DEFAULT 0,
  "sellerPortfoliosDiscovered" INTEGER NOT NULL DEFAULT 0,
  "portfolioListingsDeepScraped" INTEGER NOT NULL DEFAULT 0,

  "omittedAgency" INTEGER NOT NULL DEFAULT 0,
  "omittedUncertain" INTEGER NOT NULL DEFAULT 0,
  "omittedMissingPhone" INTEGER NOT NULL DEFAULT 0,
  "omittedNonRealEstate" INTEGER NOT NULL DEFAULT 0,
  "omittedDuplicate" INTEGER NOT NULL DEFAULT 0,
  "omittedBudgetExhausted" INTEGER NOT NULL DEFAULT 0,

  "errorsAuth" INTEGER NOT NULL DEFAULT 0,
  "errorsNetwork" INTEGER NOT NULL DEFAULT 0,
  "errorsExtraction" INTEGER NOT NULL DEFAULT 0,
  "errorsUnknown" INTEGER NOT NULL DEFAULT 0,
  "errorsTotal" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "DeepScrapeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeepScrapeRunStage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "runId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "taskId" TEXT,

  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'info',
  "reasonCode" TEXT,
  "message" TEXT,
  "counters" JSONB,
  "metadata" JSONB,

  CONSTRAINT "DeepScrapeRunStage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeepScrapeRun_locationId_createdAt_idx"
  ON "DeepScrapeRun"("locationId", "createdAt" DESC);

CREATE INDEX "DeepScrapeRun_locationId_status_createdAt_idx"
  ON "DeepScrapeRun"("locationId", "status", "createdAt" DESC);

CREATE INDEX "DeepScrapeRunStage_runId_createdAt_idx"
  ON "DeepScrapeRunStage"("runId", "createdAt" DESC);

CREATE INDEX "DeepScrapeRunStage_locationId_createdAt_idx"
  ON "DeepScrapeRunStage"("locationId", "createdAt" DESC);

CREATE INDEX "DeepScrapeRunStage_taskId_createdAt_idx"
  ON "DeepScrapeRunStage"("taskId", "createdAt" DESC);

CREATE INDEX "DeepScrapeRunStage_reasonCode_idx"
  ON "DeepScrapeRunStage"("reasonCode");

CREATE INDEX "DeepScrapeRunStage_stage_idx"
  ON "DeepScrapeRunStage"("stage");

ALTER TABLE "DeepScrapeRun"
  ADD CONSTRAINT "DeepScrapeRun_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeepScrapeRunStage"
  ADD CONSTRAINT "DeepScrapeRunStage_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "DeepScrapeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeepScrapeRunStage"
  ADD CONSTRAINT "DeepScrapeRunStage_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeepScrapeRunStage"
  ADD CONSTRAINT "DeepScrapeRunStage_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "ScrapingTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One-time status compatibility backfill
UPDATE "ScrapedListing"
SET "status" = 'REVIEWING'
WHERE UPPER("status") = 'REVIEWED';
