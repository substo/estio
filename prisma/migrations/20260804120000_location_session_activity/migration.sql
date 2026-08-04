-- CreateTable
CREATE TABLE "LocationSessionActivity" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clerkSessionId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationSessionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationSessionActivity_locationId_clerkSessionId_key"
ON "LocationSessionActivity"("locationId", "clerkSessionId");

-- CreateIndex
CREATE INDEX "LocationSessionActivity_locationId_lastSeenAt_idx"
ON "LocationSessionActivity"("locationId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "LocationSessionActivity" ADD CONSTRAINT "LocationSessionActivity_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSessionActivity" ADD CONSTRAINT "LocationSessionActivity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
