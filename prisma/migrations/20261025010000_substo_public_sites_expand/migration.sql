-- Additive: previous releases/writers retain their existing domain behavior.
ALTER TABLE "SearchConfig"
  ADD COLUMN "substoSiteSlug" VARCHAR(63),
  ADD COLUMN "substoSitePublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "substoSiteConfig" JSONB;
CREATE UNIQUE INDEX "SearchConfig_substoSiteSlug_key" ON "SearchConfig"("substoSiteSlug");
ALTER TABLE "SearchConfig" ADD CONSTRAINT "SearchConfig_substo_site_address_check"
  CHECK (("substoSiteSlug" IS NULL OR "substoSiteSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    AND (NOT "substoSitePublished" OR "substoSiteSlug" IS NOT NULL));
