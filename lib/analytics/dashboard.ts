import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

type CountRow = Record<string, bigint | number | string | Date | null>;

function toNumber(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function toDateKey(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

export type AnalyticsDashboardRange = 7 | 30 | 90;

export type AnalyticsDashboard = {
  locationId: string;
  rangeDays: AnalyticsDashboardRange;
  totals: {
    visitors: number;
    sessions: number;
    pageViews: number;
    propertyViews: number;
    searches: number;
    favorites: number;
    inquiries: number;
    conversions: number;
    adminEvents: number;
    conversionRate: number;
  };
  daily: Array<{
    date: string;
    visitors: number;
    sessions: number;
    pageViews: number;
    propertyViews: number;
    inquiries: number;
  }>;
  topPages: Array<{ path: string; views: number }>;
  topProperties: Array<{ propertyId: string; title: string; slug: string; views: number; inquiries: number }>;
  sources: Array<{ source: string; medium: string; sessions: number; conversions: number }>;
  adminUsage: Array<{ path: string; events: number }>;
  recentConversions: Array<{ occurredAt: string; eventName: string; path: string; propertyTitle: string | null; contactName: string | null }>;
};

export function parseAnalyticsRange(value: string | string[] | undefined): AnalyticsDashboardRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "7" || raw === "90") return Number(raw) as AnalyticsDashboardRange;
  return 30;
}

export async function getAnalyticsDashboard(rangeDays: AnalyticsDashboardRange): Promise<AnalyticsDashboard | null> {
  const [{ userId }, location] = await Promise.all([
    auth(),
    getLocationContext(),
  ]);
  if (!userId || !location?.id) return null;

  const isLocationAdmin = await verifyUserIsLocationAdmin(userId, location.id);
  if (!isLocationAdmin) return null;

  const startDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const locationId = location.id;

  const [
    totalsRows,
    dailyRows,
    topPageRows,
    topPropertyRows,
    sourceRows,
    adminRows,
    conversionRows,
  ] = await Promise.all([
    db.$queryRaw<CountRow[]>`
      SELECT
        COUNT(DISTINCT "visitorId") FILTER (WHERE "visitorId" IS NOT NULL) AS visitors,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "sessionId" IS NOT NULL) AS sessions,
        COUNT(*) FILTER (WHERE "eventName" = 'page_view') AS "pageViews",
        COUNT(*) FILTER (WHERE "eventName" = 'property_view') AS "propertyViews",
        COUNT(*) FILTER (WHERE "eventName" IN ('search_view', 'search_apply')) AS searches,
        COUNT(*) FILTER (WHERE "eventName" IN ('favorite_add', 'favorite_remove')) AS favorites,
        COUNT(*) FILTER (WHERE "eventName" = 'lead_inquiry_success') AS inquiries,
        COUNT(*) FILTER (WHERE "eventName" IN ('lead_inquiry_success', 'saved_search_create')) AS conversions,
        COUNT(*) FILTER (WHERE "eventName" IN ('admin_page_view', 'admin_feature_use')) AS "adminEvents"
      FROM "AnalyticsEvent"
      WHERE "locationId" = ${locationId}
        AND "occurredAt" >= ${startDate}
    `,
    db.$queryRaw<CountRow[]>`
      SELECT
        DATE_TRUNC('day', "occurredAt") AS date,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "visitorId" IS NOT NULL) AS visitors,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "sessionId" IS NOT NULL) AS sessions,
        COUNT(*) FILTER (WHERE "eventName" = 'page_view') AS "pageViews",
        COUNT(*) FILTER (WHERE "eventName" = 'property_view') AS "propertyViews",
        COUNT(*) FILTER (WHERE "eventName" = 'lead_inquiry_success') AS inquiries
      FROM "AnalyticsEvent"
      WHERE "locationId" = ${locationId}
        AND "occurredAt" >= ${startDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COALESCE("path", '/') AS path, COUNT(*) AS views
      FROM "AnalyticsEvent"
      WHERE "locationId" = ${locationId}
        AND "occurredAt" >= ${startDate}
        AND "eventName" IN ('page_view', 'property_view', 'search_view')
      GROUP BY 1
      ORDER BY views DESC
      LIMIT 10
    `,
    db.$queryRaw<CountRow[]>`
      SELECT
        e."propertyId" AS "propertyId",
        COALESCE(p."title", MAX(e."entityId"), 'Unknown property') AS title,
        COALESCE(p."slug", '') AS slug,
        COUNT(*) FILTER (WHERE e."eventName" = 'property_view') AS views,
        COUNT(*) FILTER (WHERE e."eventName" = 'lead_inquiry_success') AS inquiries
      FROM "AnalyticsEvent" e
      LEFT JOIN "Property" p
        ON p."id" = e."propertyId"
       AND p."locationId" = e."locationId"
      WHERE e."locationId" = ${locationId}
        AND e."occurredAt" >= ${startDate}
        AND e."propertyId" IS NOT NULL
      GROUP BY e."propertyId", p."title", p."slug"
      ORDER BY views DESC, inquiries DESC
      LIMIT 10
    `,
    db.$queryRaw<CountRow[]>`
      SELECT
        COALESCE("source", 'direct') AS source,
        COALESCE("medium", 'none') AS medium,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "sessionId" IS NOT NULL) AS sessions,
        COUNT(*) FILTER (WHERE "eventName" IN ('lead_inquiry_success', 'saved_search_create')) AS conversions
      FROM "AnalyticsEvent"
      WHERE "locationId" = ${locationId}
        AND "occurredAt" >= ${startDate}
      GROUP BY 1, 2
      ORDER BY sessions DESC, conversions DESC
      LIMIT 10
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COALESCE("path", '/admin') AS path, COUNT(*) AS events
      FROM "AnalyticsEvent"
      WHERE "locationId" = ${locationId}
        AND "occurredAt" >= ${startDate}
        AND "eventName" IN ('admin_page_view', 'admin_feature_use')
      GROUP BY 1
      ORDER BY events DESC
      LIMIT 10
    `,
    db.$queryRaw<CountRow[]>`
      SELECT
        e."occurredAt" AS "occurredAt",
        e."eventName" AS "eventName",
        COALESCE(e."path", '') AS path,
        p."title" AS "propertyTitle",
        c."name" AS "contactName"
      FROM "AnalyticsEvent" e
      LEFT JOIN "Property" p
        ON p."id" = e."propertyId"
       AND p."locationId" = e."locationId"
      LEFT JOIN "Contact" c
        ON c."id" = e."contactId"
       AND c."locationId" = e."locationId"
      WHERE e."locationId" = ${locationId}
        AND e."occurredAt" >= ${startDate}
        AND e."eventName" IN ('lead_inquiry_success', 'saved_search_create')
      ORDER BY e."occurredAt" DESC
      LIMIT 12
    `,
  ]);

  const totalsRow = totalsRows[0] || {};
  const sessions = toNumber(totalsRow.sessions);
  const conversions = toNumber(totalsRow.conversions);

  return {
    locationId,
    rangeDays,
    totals: {
      visitors: toNumber(totalsRow.visitors),
      sessions,
      pageViews: toNumber(totalsRow.pageViews),
      propertyViews: toNumber(totalsRow.propertyViews),
      searches: toNumber(totalsRow.searches),
      favorites: toNumber(totalsRow.favorites),
      inquiries: toNumber(totalsRow.inquiries),
      conversions,
      adminEvents: toNumber(totalsRow.adminEvents),
      conversionRate: sessions > 0 ? conversions / sessions : 0,
    },
    daily: dailyRows.map((row) => ({
      date: toDateKey(row.date),
      visitors: toNumber(row.visitors),
      sessions: toNumber(row.sessions),
      pageViews: toNumber(row.pageViews),
      propertyViews: toNumber(row.propertyViews),
      inquiries: toNumber(row.inquiries),
    })),
    topPages: topPageRows.map((row) => ({
      path: String(row.path || "/"),
      views: toNumber(row.views),
    })),
    topProperties: topPropertyRows.map((row) => ({
      propertyId: String(row.propertyId || ""),
      title: String(row.title || "Unknown property"),
      slug: String(row.slug || ""),
      views: toNumber(row.views),
      inquiries: toNumber(row.inquiries),
    })),
    sources: sourceRows.map((row) => ({
      source: String(row.source || "direct"),
      medium: String(row.medium || "none"),
      sessions: toNumber(row.sessions),
      conversions: toNumber(row.conversions),
    })),
    adminUsage: adminRows.map((row) => ({
      path: String(row.path || "/admin"),
      events: toNumber(row.events),
    })),
    recentConversions: conversionRows.map((row) => ({
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt || ""),
      eventName: String(row.eventName || ""),
      path: String(row.path || ""),
      propertyTitle: row.propertyTitle ? String(row.propertyTitle) : null,
      contactName: row.contactName ? String(row.contactName) : null,
    })),
  };
}
