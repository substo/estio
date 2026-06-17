import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

const guard = new CronGuard("analytics-rollup");

function parseRollupDate(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("date");
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    return new Date(`${explicit}T00:00:00.000Z`);
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));
}

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(300, 6.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: "locked" });
  }

  const dayStart = parseRollupDate(request);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    await db.$transaction([
      db.$executeRaw`
        DELETE FROM "AnalyticsDailyRollup"
        WHERE "date" = ${dayStart}
          AND "segment" = 'all'
      `,
      db.$executeRaw`
        INSERT INTO "AnalyticsDailyRollup" (
          "id",
          "createdAt",
          "updatedAt",
          "locationId",
          "date",
          "segment",
          "visitors",
          "sessions",
          "pageViews",
          "propertyViews",
          "searches",
          "favorites",
          "inquiries",
          "conversions",
          "adminEvents",
          "metadata"
        )
        SELECT
          md5("locationId" || ':' || ${dayStart}::text || ':all'),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          "locationId",
          ${dayStart},
          'all',
          COUNT(DISTINCT "visitorId") FILTER (WHERE "visitorId" IS NOT NULL)::int,
          COUNT(DISTINCT "sessionId") FILTER (WHERE "sessionId" IS NOT NULL)::int,
          COUNT(*) FILTER (WHERE "eventName" IN ('page_view', 'admin_page_view'))::int,
          COUNT(*) FILTER (WHERE "eventName" = 'property_view')::int,
          COUNT(*) FILTER (WHERE "eventName" IN ('search_view', 'search_apply'))::int,
          COUNT(*) FILTER (WHERE "eventName" IN ('favorite_add', 'favorite_remove'))::int,
          COUNT(*) FILTER (WHERE "eventName" = 'lead_inquiry_success')::int,
          COUNT(*) FILTER (WHERE "eventName" IN ('lead_inquiry_success', 'saved_search_create'))::int,
          COUNT(*) FILTER (WHERE "eventName" IN ('admin_page_view', 'admin_feature_use'))::int,
          NULL
        FROM "AnalyticsEvent"
        WHERE "occurredAt" >= ${dayStart}
          AND "occurredAt" < ${dayEnd}
        GROUP BY "locationId"
      `,
    ]);

    return NextResponse.json({
      success: true,
      date: dayStart.toISOString().slice(0, 10),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Analytics rollup failed",
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
