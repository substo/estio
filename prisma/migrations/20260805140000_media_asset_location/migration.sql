ALTER TABLE "MediaAsset" ADD COLUMN "locationId" TEXT;

UPDATE "MediaAsset" AS asset
SET "locationId" = ownership."locationId"
FROM (
  SELECT media."cloudflareImageId", MIN(property."locationId") AS "locationId"
  FROM "PropertyMedia" AS media
  INNER JOIN "Property" AS property ON property.id = media."propertyId"
  WHERE media."cloudflareImageId" IS NOT NULL
  GROUP BY media."cloudflareImageId"
  HAVING COUNT(DISTINCT property."locationId") = 1
) AS ownership
WHERE ownership."cloudflareImageId" = asset."cloudflareImageId";

DO $$
DECLARE
  media_location_count INTEGER;
  sole_media_location TEXT;
BEGIN
  SELECT COUNT(DISTINCT property."locationId"), MIN(property."locationId")
  INTO media_location_count, sole_media_location
  FROM "MediaAsset" AS asset
  INNER JOIN "PropertyMedia" AS media ON media."cloudflareImageId" = asset."cloudflareImageId"
  INNER JOIN "Property" AS property ON property.id = media."propertyId";

  IF media_location_count = 1 THEN
    UPDATE "MediaAsset"
    SET "locationId" = sole_media_location
    WHERE "locationId" IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaAsset" WHERE "locationId" IS NULL) THEN
    RAISE EXCEPTION 'MediaAsset location backfill is ambiguous; classify remaining assets before applying this migration';
  END IF;
END $$;

ALTER TABLE "MediaAsset" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "MediaAsset_locationId_status_deletedAt_idx"
ON "MediaAsset"("locationId", "status", "deletedAt");

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
