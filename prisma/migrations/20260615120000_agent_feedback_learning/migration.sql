-- Generic agent feedback and human-approved learning proposal foundation.

CREATE TABLE "agent_feedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "sourceFeature" TEXT NOT NULL,
    "sourceAction" TEXT,
    "agentExecutionId" TEXT,
    "aiDecisionId" TEXT,
    "traceId" TEXT,
    "skillId" TEXT,
    "model" TEXT,
    "aiOutput" TEXT,
    "humanOutput" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'sent',
    "rating" TEXT,
    "feedbackReason" TEXT,
    "editDistance" DOUBLE PRECISION,
    "materialEdit" BOOLEAN NOT NULL DEFAULT false,
    "toolTrace" JSONB,
    "metadata" JSONB,
    "analyzed" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" TIMESTAMP(3),
    "learningSessionId" TEXT,

    CONSTRAINT "agent_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_sessions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceFeature" TEXT,
    "inputType" TEXT NOT NULL DEFAULT 'feedback_batch',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "analysis" JSONB,
    "proposalsCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "learning_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_proposals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "target" JSONB,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "confidence" DOUBLE PRECISION,
    "appliedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "learning_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_feedback_locationId_sourceFeature_createdAt_idx" ON "agent_feedback"("locationId", "sourceFeature", "createdAt" DESC);
CREATE INDEX "agent_feedback_conversationId_createdAt_idx" ON "agent_feedback"("conversationId", "createdAt" DESC);
CREATE INDEX "agent_feedback_contactId_createdAt_idx" ON "agent_feedback"("contactId", "createdAt" DESC);
CREATE INDEX "agent_feedback_agentExecutionId_idx" ON "agent_feedback"("agentExecutionId");
CREATE INDEX "agent_feedback_aiDecisionId_idx" ON "agent_feedback"("aiDecisionId");
CREATE INDEX "agent_feedback_analyzed_createdAt_idx" ON "agent_feedback"("analyzed", "createdAt");

CREATE INDEX "learning_sessions_locationId_status_createdAt_idx" ON "learning_sessions"("locationId", "status", "createdAt" DESC);
CREATE INDEX "learning_sessions_locationId_sourceFeature_createdAt_idx" ON "learning_sessions"("locationId", "sourceFeature", "createdAt" DESC);

CREATE INDEX "learning_proposals_locationId_status_createdAt_idx" ON "learning_proposals"("locationId", "status", "createdAt" DESC);
CREATE INDEX "learning_proposals_sessionId_status_idx" ON "learning_proposals"("sessionId", "status");
CREATE INDEX "learning_proposals_locationId_type_status_idx" ON "learning_proposals"("locationId", "type", "status");

ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_aiDecisionId_fkey" FOREIGN KEY ("aiDecisionId") REFERENCES "AiDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_learningSessionId_fkey" FOREIGN KEY ("learningSessionId") REFERENCES "learning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_proposals" ADD CONSTRAINT "learning_proposals_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_proposals" ADD CONSTRAINT "learning_proposals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "learning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
