ALTER TABLE "ViewingSession"
ADD COLUMN "sessionKind" TEXT NOT NULL DEFAULT 'structured_viewing',
ADD COLUMN "participantMode" TEXT NOT NULL DEFAULT 'shared_client',
ADD COLUMN "speechMode" TEXT DEFAULT 'push_to_talk',
ADD COLUMN "savePolicy" TEXT NOT NULL DEFAULT 'full_session',
ADD COLUMN "entryPoint" TEXT,
ADD COLUMN "quickStartSource" TEXT,
ADD COLUMN "assignmentStatus" TEXT NOT NULL DEFAULT 'assigned',
ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "assignedByUserId" TEXT,
ADD COLUMN "contextAttachedAt" TIMESTAMP(3),
ADD COLUMN "convertedFromSessionKind" TEXT;

ALTER TABLE "ViewingSession"
ALTER COLUMN "viewingId" DROP NOT NULL,
ALTER COLUMN "contactId" DROP NOT NULL,
ALTER COLUMN "primaryPropertyId" DROP NOT NULL,
ALTER COLUMN "sessionLinkTokenHash" DROP NOT NULL,
ALTER COLUMN "pinCodeHash" DROP NOT NULL,
ALTER COLUMN "pinCodeSalt" DROP NOT NULL,
ALTER COLUMN "tokenExpiresAt" DROP NOT NULL;

UPDATE "ViewingSession"
SET
    "sessionKind" = 'structured_viewing',
    "participantMode" = 'shared_client',
    "speechMode" = COALESCE("speechMode", 'push_to_talk'),
    "savePolicy" = 'full_session',
    "assignmentStatus" = CASE
        WHEN "contactId" IS NULL THEN 'unassigned'
        ELSE 'assigned'
    END,
    "assignedAt" = CASE
        WHEN "contactId" IS NULL THEN NULL
        ELSE COALESCE("assignedAt", "updatedAt", "createdAt")
    END,
    "contextAttachedAt" = CASE
        WHEN "contactId" IS NOT NULL OR "primaryPropertyId" IS NOT NULL OR "viewingId" IS NOT NULL
            THEN COALESCE("contextAttachedAt", "updatedAt", "createdAt")
        ELSE NULL
    END,
    "quickStartSource" = CASE
        WHEN "viewingId" IS NOT NULL THEN 'viewing'
        ELSE COALESCE("quickStartSource", 'global')
    END
WHERE 1 = 1;

CREATE INDEX "ViewingSession_locationId_assignmentStatus_createdAt_idx"
ON "ViewingSession"("locationId", "assignmentStatus", "createdAt" DESC);

CREATE INDEX "ViewingSession_locationId_sessionKind_createdAt_idx"
ON "ViewingSession"("locationId", "sessionKind", "createdAt" DESC);

CREATE INDEX "ViewingSession_locationId_participantMode_createdAt_idx"
ON "ViewingSession"("locationId", "participantMode", "createdAt" DESC);

ALTER TABLE "ViewingSession"
ADD CONSTRAINT "ViewingSession_assignedByUserId_fkey"
FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
