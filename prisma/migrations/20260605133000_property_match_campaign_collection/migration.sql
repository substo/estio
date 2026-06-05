ALTER TABLE "PropertyMatchCampaign"
  ADD COLUMN "collectionStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "collectionCursor" TEXT,
  ADD COLUMN "collectionLockedAt" TIMESTAMP(3),
  ADD COLUMN "collectionLockedBy" TEXT,
  ADD COLUMN "collectionFinishedAt" TIMESTAMP(3);

CREATE INDEX "PropertyMatchCampaign_locationId_collectionStatus_createdAt_idx"
  ON "PropertyMatchCampaign"("locationId", "collectionStatus", "createdAt" ASC);
