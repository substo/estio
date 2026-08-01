-- Canonical operational ownership for Contacts. locationId remains the tenancy boundary.
ALTER TABLE "Contact" ADD COLUMN "assignedUserId" TEXT;

-- Backfill only exact internal User IDs with both an authoritative role and an
-- active LocationToUser membership. Legacy/opaque values deliberately remain NULL.
UPDATE "Contact" AS contact
SET "assignedUserId" = contact."leadAssignedToAgent"
WHERE contact."leadAssignedToAgent" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "User" AS app_user
    JOIN "UserLocationRole" AS role
      ON role."userId" = app_user.id
     AND role."locationId" = contact."locationId"
    JOIN "_LocationToUser" AS membership
      ON membership."A" = contact."locationId"
     AND membership."B" = app_user.id
    WHERE app_user.id = contact."leadAssignedToAgent"
  );

CREATE INDEX "Contact_locationId_assignedUserId_idx"
ON "Contact"("locationId", "assignedUserId");

ALTER TABLE "Contact"
ADD CONSTRAINT "Contact_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- New members start assigned-only. Existing members retain the location-wide
-- visibility they had before contact assignment was introduced.
CREATE TYPE "ContactAccessScope" AS ENUM ('ASSIGNED_ONLY', 'LOCATION_WIDE');

ALTER TABLE "UserLocationRole"
ADD COLUMN "contactAccessScope" "ContactAccessScope" NOT NULL DEFAULT 'ASSIGNED_ONLY';

UPDATE "UserLocationRole"
SET "contactAccessScope" = 'LOCATION_WIDE'
WHERE "role" = 'MEMBER';
