ALTER TABLE "Location"
ADD COLUMN "publicListingUrlMode" TEXT NOT NULL DEFAULT 'ESTIO',
ADD COLUMN "legacyPublicListingUrlPattern" TEXT;

ALTER TABLE "Property"
ADD COLUMN "externalPublicUrl" TEXT,
ADD COLUMN "externalPublicUrlSource" TEXT,
ADD COLUMN "legacyCrmPropertyId" TEXT;
