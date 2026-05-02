-- Idempotent production repair for Prisma migration 20260423120000_legacy_crm_owner_identity.
-- Run against the production database before `prisma migrate resolve --applied 20260423120000_legacy_crm_owner_identity`.

ALTER TABLE "Contact"
    ADD COLUMN IF NOT EXISTS "legacyCrmOwnerId" TEXT,
    ADD COLUMN IF NOT EXISTS "legacyCrmOwnerLabel" TEXT;

ALTER TABLE "Company"
    ADD COLUMN IF NOT EXISTS "legacyCrmOwnerId" TEXT,
    ADD COLUMN IF NOT EXISTS "legacyCrmOwnerLabel" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_locationId_legacyCrmOwnerId_key"
    ON "Contact"("locationId", "legacyCrmOwnerId");

CREATE INDEX IF NOT EXISTS "Contact_legacyCrmOwnerId_idx"
    ON "Contact"("legacyCrmOwnerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Company_locationId_legacyCrmOwnerId_key"
    ON "Company"("locationId", "legacyCrmOwnerId");

CREATE INDEX IF NOT EXISTS "Company_legacyCrmOwnerId_idx"
    ON "Company"("legacyCrmOwnerId");
