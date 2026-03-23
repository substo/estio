ALTER TABLE "ProspectLead"
ADD COLUMN "sellerType" TEXT NOT NULL DEFAULT 'private',
ADD COLUMN "sellerTypeManual" TEXT;

UPDATE "ProspectLead"
SET "sellerType" = CASE
  WHEN "isAgency" = true THEN 'agency'
  ELSE 'private'
END
WHERE "sellerType" IS NULL OR "sellerType" = 'private';

UPDATE "ProspectLead"
SET "sellerTypeManual" = CASE
  WHEN "isAgencyManual" = true THEN 'agency'
  WHEN "isAgencyManual" = false THEN 'private'
  ELSE NULL
END
WHERE "isAgencyManual" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ProspectLead_locationId_sellerType_status_idx"
ON "ProspectLead"("locationId", "sellerType", "status");
