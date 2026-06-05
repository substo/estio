ALTER TABLE "PropertyMatchCampaign"
  DROP CONSTRAINT "PropertyMatchCampaign_propertyId_fkey";

ALTER TABLE "PropertyMatchCampaign"
  ALTER COLUMN "propertyId" DROP NOT NULL;

ALTER TABLE "PropertyMatchCampaign"
  ADD CONSTRAINT "PropertyMatchCampaign_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
