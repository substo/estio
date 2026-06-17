CREATE TABLE "AnalyticsVisitor" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationId" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "firstSource" TEXT,
    "firstMedium" TEXT,
    "firstCampaign" TEXT,
    "firstReferrer" TEXT,
    "firstLandingPath" TEXT,
    "lastSource" TEXT,
    "lastMedium" TEXT,
    "lastCampaign" TEXT,
    "lastReferrer" TEXT,
    "lastLandingPath" TEXT,
    "ipHash" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "userAgent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "deviceType" TEXT,
    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "locationId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "externalSessionId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "currentPath" TEXT,
    "referrer" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "term" TEXT,
    "content" TEXT,
    "ipHash" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "userAgent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "deviceType" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "pageViewCount" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "convertedAt" TIMESTAMP(3),
    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationId" TEXT NOT NULL,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "contactId" TEXT,
    "propertyId" TEXT,
    "eventName" TEXT NOT NULL,
    "path" TEXT,
    "title" TEXT,
    "referrer" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsDailyRollup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "propertyViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "favorites" INTEGER NOT NULL DEFAULT 0,
    "inquiries" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "adminEvents" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    CONSTRAINT "AnalyticsDailyRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsVisitor_locationId_anonymousId_key" ON "AnalyticsVisitor"("locationId", "anonymousId");
CREATE INDEX "AnalyticsVisitor_locationId_lastSeenAt_idx" ON "AnalyticsVisitor"("locationId", "lastSeenAt" DESC);
CREATE INDEX "AnalyticsVisitor_userId_idx" ON "AnalyticsVisitor"("userId");
CREATE INDEX "AnalyticsVisitor_contactId_idx" ON "AnalyticsVisitor"("contactId");
CREATE INDEX "AnalyticsVisitor_ipHash_idx" ON "AnalyticsVisitor"("ipHash");

CREATE UNIQUE INDEX "AnalyticsSession_locationId_externalSessionId_key" ON "AnalyticsSession"("locationId", "externalSessionId");
CREATE INDEX "AnalyticsSession_locationId_startedAt_idx" ON "AnalyticsSession"("locationId", "startedAt" DESC);
CREATE INDEX "AnalyticsSession_visitorId_startedAt_idx" ON "AnalyticsSession"("visitorId", "startedAt" DESC);
CREATE INDEX "AnalyticsSession_locationId_source_medium_startedAt_idx" ON "AnalyticsSession"("locationId", "source", "medium", "startedAt" DESC);

CREATE INDEX "AnalyticsEvent_locationId_occurredAt_idx" ON "AnalyticsEvent"("locationId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_locationId_eventName_occurredAt_idx" ON "AnalyticsEvent"("locationId", "eventName", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_locationId_entityType_entityId_occurredAt_idx" ON "AnalyticsEvent"("locationId", "entityType", "entityId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_propertyId_occurredAt_idx" ON "AnalyticsEvent"("propertyId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_idx" ON "AnalyticsEvent"("sessionId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_visitorId_occurredAt_idx" ON "AnalyticsEvent"("visitorId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt" DESC);
CREATE INDEX "AnalyticsEvent_contactId_occurredAt_idx" ON "AnalyticsEvent"("contactId", "occurredAt" DESC);

CREATE UNIQUE INDEX "AnalyticsDailyRollup_locationId_date_segment_key" ON "AnalyticsDailyRollup"("locationId", "date", "segment");
CREATE INDEX "AnalyticsDailyRollup_locationId_date_idx" ON "AnalyticsDailyRollup"("locationId", "date" DESC);

ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalyticsDailyRollup" ADD CONSTRAINT "AnalyticsDailyRollup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
