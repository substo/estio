-- Viewing timezone hardening metadata
-- Keep nullable for backward compatibility; app layer enforces on new writes.

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "timeZone" TEXT;

ALTER TABLE "Location"
    ADD COLUMN IF NOT EXISTS "timeZone" TEXT;

ALTER TABLE "Viewing"
    ADD COLUMN IF NOT EXISTS "scheduledTimeZone" TEXT,
    ADD COLUMN IF NOT EXISTS "scheduledLocal" TEXT;
