ALTER TABLE "Contact"
  ADD COLUMN "profileVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "profileVerificationStatus" TEXT,
  ADD COLUMN "profileVerificationSource" TEXT,
  ADD COLUMN "profileVerificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "profileVerificationSummary" TEXT;

CREATE INDEX "Contact_locationId_profileVerificationStatus_idx"
  ON "Contact"("locationId", "profileVerificationStatus");
