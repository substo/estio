-- Substo hosted website address and publish switch move from SiteConfig ("SearchConfig") to Location (phase 6).
ALTER TABLE "Location" ADD COLUMN "websiteSlug" VARCHAR(63), ADD COLUMN "websitePublished" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Location_websiteSlug_key" ON "Location"("websiteSlug");
UPDATE "Location" l SET "websiteSlug" = s."substoSiteSlug", "websitePublished" = s."substoSitePublished"
FROM "SearchConfig" s WHERE s."locationId" = l."id" AND s."substoSiteSlug" IS NOT NULL;
