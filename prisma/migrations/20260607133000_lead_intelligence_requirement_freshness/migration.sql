ALTER TABLE "Contact"
  ADD COLUMN "requirementsLastAssessedAt" TIMESTAMP(3),
  ADD COLUMN "requirementsAssessmentDueAt" TIMESTAMP(3),
  ADD COLUMN "requirementsLastError" TEXT;

CREATE INDEX "Contact_locationId_requirementsAssessmentDueAt_idx"
  ON "Contact"("locationId", "requirementsAssessmentDueAt");

CREATE INDEX "Contact_locationId_requirementsLastAssessedAt_idx"
  ON "Contact"("locationId", "requirementsLastAssessedAt");
