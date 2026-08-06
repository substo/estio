ALTER TABLE "Location"
ADD COLUMN "isPlatformMaster" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Location_single_platform_master_idx"
ON "Location" ("isPlatformMaster")
WHERE "isPlatformMaster" = true;
