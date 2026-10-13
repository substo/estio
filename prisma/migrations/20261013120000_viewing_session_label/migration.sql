ALTER TABLE "ViewingSession" ADD COLUMN "label" VARCHAR(80);

CREATE INDEX "ViewingSession_locationId_label_updatedAt_idx"
ON "ViewingSession"("locationId", "label", "updatedAt" DESC);
