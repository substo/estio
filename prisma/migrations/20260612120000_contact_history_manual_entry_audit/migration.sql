ALTER TABLE "ContactHistory"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedById" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT,
ADD COLUMN "deletedReason" TEXT;

CREATE INDEX "ContactHistory_contactId_deletedAt_createdAt_idx"
ON "ContactHistory" ("contactId", "deletedAt", "createdAt" DESC);
