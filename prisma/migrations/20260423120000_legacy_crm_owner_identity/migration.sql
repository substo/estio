ALTER TABLE "Contact"
    ADD COLUMN "legacyCrmOwnerId" TEXT,
    ADD COLUMN "legacyCrmOwnerLabel" TEXT;

ALTER TABLE "Company"
    ADD COLUMN "legacyCrmOwnerId" TEXT,
    ADD COLUMN "legacyCrmOwnerLabel" TEXT;

CREATE UNIQUE INDEX "Contact_locationId_legacyCrmOwnerId_key"
    ON "Contact"("locationId", "legacyCrmOwnerId");

CREATE INDEX "Contact_legacyCrmOwnerId_idx"
    ON "Contact"("legacyCrmOwnerId");

CREATE UNIQUE INDEX "Company_locationId_legacyCrmOwnerId_key"
    ON "Company"("locationId", "legacyCrmOwnerId");

CREATE INDEX "Company_legacyCrmOwnerId_idx"
    ON "Company"("legacyCrmOwnerId");
