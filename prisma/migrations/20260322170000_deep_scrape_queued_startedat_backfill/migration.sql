-- Deep run lifecycle now uses queued -> running timestamps explicitly.
ALTER TABLE "DeepScrapeRun"
ALTER COLUMN "startedAt" DROP DEFAULT;

ALTER TABLE "DeepScrapeRun"
ALTER COLUMN "startedAt" DROP NOT NULL;

-- Queued deep runs should not be marked as started.
UPDATE "DeepScrapeRun"
SET "startedAt" = NULL
WHERE "status" = 'queued'
  AND "startedAt" IS NOT NULL;
