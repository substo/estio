-- CreateTable
CREATE TABLE "location_ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL DEFAULT 'style_policy',
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "proposalId" TEXT,
    "previousVersionId" TEXT,
    "approvedByUserId" TEXT,
    "revertedFromVersionId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "location_ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_knowledge_entries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ai_learning',
    "source" TEXT NOT NULL DEFAULT 'learning_proposal',
    "proposalId" TEXT,
    "approvedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "location_knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_ai_prompt_versions_locationId_skillId_targetKind_isCurrent_idx" ON "location_ai_prompt_versions"("locationId", "skillId", "targetKind", "isCurrent");

-- CreateIndex
CREATE INDEX "location_ai_prompt_versions_locationId_skillId_targetKind_createdAt_idx" ON "location_ai_prompt_versions"("locationId", "skillId", "targetKind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "location_ai_prompt_versions_proposalId_idx" ON "location_ai_prompt_versions"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "location_knowledge_entries_locationId_key_key" ON "location_knowledge_entries"("locationId", "key");

-- CreateIndex
CREATE INDEX "location_knowledge_entries_locationId_category_archivedAt_idx" ON "location_knowledge_entries"("locationId", "category", "archivedAt");

-- CreateIndex
CREATE INDEX "location_knowledge_entries_proposalId_idx" ON "location_knowledge_entries"("proposalId");

-- AddForeignKey
ALTER TABLE "location_ai_prompt_versions" ADD CONSTRAINT "location_ai_prompt_versions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_knowledge_entries" ADD CONSTRAINT "location_knowledge_entries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
