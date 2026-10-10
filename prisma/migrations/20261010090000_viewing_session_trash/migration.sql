ALTER TABLE "ViewingSession" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "trashPurgedAt" TIMESTAMP(3);

CREATE INDEX "ViewingSession_locationId_deletedAt_updatedAt_idx" ON "ViewingSession"("locationId", "deletedAt", "updatedAt" DESC);
CREATE INDEX "ViewingSession_deletedAt_trashPurgedAt_idx" ON "ViewingSession"("deletedAt", "trashPurgedAt");
