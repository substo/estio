ALTER TABLE "Contact"
  ADD COLUMN "profileVerificationDueAt" TIMESTAMP(3),
  ADD COLUMN "profileVerificationLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "profileVerificationLastError" TEXT,
  ADD COLUMN "profileVerificationAttemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Contact_locationId_profileVerificationDueAt_idx"
  ON "Contact"("locationId", "profileVerificationDueAt");

CREATE INDEX "Contact_locationId_profileVerifiedAt_idx"
  ON "Contact"("locationId", "profileVerifiedAt");
