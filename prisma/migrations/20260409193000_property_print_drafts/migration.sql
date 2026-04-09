CREATE TABLE "PropertyPrintDraft" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "paperSize" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "designSettings" JSONB,
    "promptSettings" JSONB,
    "generatedContent" JSONB,
    "generationMetadata" JSONB,

    CONSTRAINT "PropertyPrintDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyPrintDraft_propertyId_updatedAt_idx"
    ON "PropertyPrintDraft"("propertyId", "updatedAt" DESC);

CREATE INDEX "PropertyPrintDraft_propertyId_isDefault_idx"
    ON "PropertyPrintDraft"("propertyId", "isDefault");

ALTER TABLE "PropertyPrintDraft"
    ADD CONSTRAINT "PropertyPrintDraft_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
