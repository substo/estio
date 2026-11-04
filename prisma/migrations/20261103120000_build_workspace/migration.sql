CREATE TABLE "BuildControl" (
 "id" TEXT PRIMARY KEY DEFAULT 'build', "paused" BOOLEAN NOT NULL DEFAULT true,
 "revision" INTEGER NOT NULL DEFAULT 1, "profiles" JSONB NOT NULL DEFAULT '[]',
 "worker" JSONB NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "BuildNode" (
 "id" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1, "spec" JSONB NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "BuildEdge" (
 "id" TEXT PRIMARY KEY, "fromId" TEXT NOT NULL REFERENCES "BuildNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "toId" TEXT NOT NULL REFERENCES "BuildNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "evidence" JSONB NOT NULL
);
CREATE UNIQUE INDEX "BuildEdge_fromId_toId_kind_key" ON "BuildEdge"("fromId", "toId", "kind");
CREATE TABLE "BuildJob" (
 "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "state" TEXT NOT NULL DEFAULT 'proposed', "spec" JSONB NOT NULL, "approval" JSONB,
 "attempt" JSONB, "checkpoint" JSONB, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "workerId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "BuildJob_key_key" ON "BuildJob"("key");
CREATE UNIQUE INDEX "BuildJob_leaseToken_key" ON "BuildJob"("leaseToken");
CREATE INDEX "BuildJob_state_createdAt_idx" ON "BuildJob"("state", "createdAt");
