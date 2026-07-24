CREATE TABLE "GoogleContactDirectoryState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GoogleContactDirectoryState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleContactDirectoryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "photo" TEXT,
    "etag" TEXT,
    "googleUpdatedAt" TIMESTAMP(3),
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "normalizedEmail" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "phoneDigits" TEXT NOT NULL DEFAULT '',
    "phoneSuffix" TEXT NOT NULL DEFAULT '',
    "phoneKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleContactDirectoryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleContactDirectoryState_userId_key"
ON "GoogleContactDirectoryState"("userId");

CREATE UNIQUE INDEX "GoogleContactDirectoryEntry_userId_resourceName_key"
ON "GoogleContactDirectoryEntry"("userId", "resourceName");

CREATE INDEX "GoogleContactDirectoryEntry_userId_phoneDigits_idx"
ON "GoogleContactDirectoryEntry"("userId", "phoneDigits");

CREATE INDEX "GoogleContactDirectoryEntry_userId_phoneSuffix_idx"
ON "GoogleContactDirectoryEntry"("userId", "phoneSuffix");

CREATE INDEX "GoogleContactDirectoryEntry_userId_normalizedEmail_idx"
ON "GoogleContactDirectoryEntry"("userId", "normalizedEmail");

CREATE INDEX "GoogleContactDirectoryEntry_userId_normalizedName_idx"
ON "GoogleContactDirectoryEntry"("userId", "normalizedName");

CREATE INDEX "GoogleContactDirectoryEntry_phoneKeys_idx"
ON "GoogleContactDirectoryEntry" USING GIN ("phoneKeys");

ALTER TABLE "GoogleContactDirectoryState"
ADD CONSTRAINT "GoogleContactDirectoryState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleContactDirectoryEntry"
ADD CONSTRAINT "GoogleContactDirectoryEntry_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
