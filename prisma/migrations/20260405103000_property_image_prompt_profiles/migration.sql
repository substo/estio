CREATE TABLE "PropertyImagePromptProfile" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "propertyId" TEXT NOT NULL,
  "roomTypeKey" TEXT NOT NULL,
  "roomTypeLabel" TEXT NOT NULL,
  "promptContext" TEXT NOT NULL,
  "updatedById" TEXT,

  CONSTRAINT "PropertyImagePromptProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropertyImagePromptProfile_propertyId_roomTypeKey_key"
  ON "PropertyImagePromptProfile"("propertyId", "roomTypeKey");

CREATE INDEX "PropertyImagePromptProfile_propertyId_updatedAt_idx"
  ON "PropertyImagePromptProfile"("propertyId", "updatedAt" DESC);

ALTER TABLE "PropertyImagePromptProfile"
  ADD CONSTRAINT "PropertyImagePromptProfile_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyImagePromptProfile"
  ADD CONSTRAINT "PropertyImagePromptProfile_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
