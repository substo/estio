ALTER TABLE "PropertyMatchCampaign"
  ADD COLUMN "scoringModel" TEXT,
  ADD COLUMN "fallbackPolicy" TEXT NOT NULL DEFAULT 'same_provider';

ALTER TABLE "PropertyMatchCandidate"
  ADD COLUMN "aiReviewAttempts" INTEGER NOT NULL DEFAULT 0;
