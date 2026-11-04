CREATE TABLE "BuildTalk" (
 "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'idle',
 "threadId" TEXT, "base" TEXT, "profile" JSONB, "messages" JSONB NOT NULL DEFAULT '[]', "plan" JSONB, "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "BuildTalk_state_updatedAt_idx" ON "BuildTalk"("state", "updatedAt");
