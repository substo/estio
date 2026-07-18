import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { CronGuard } from "@/lib/cron/guard";
import { backfillContactPropertyMatchProfiles } from "@/lib/property-match-campaigns/profile-service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("property-match-profiles");

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(450, 5.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: "locked" });
  }

  try {
    const startedAt = Date.now();
    const stats = await backfillContactPropertyMatchProfiles({
      locationId: String(request.nextUrl.searchParams.get("locationId") || "").trim() || undefined,
      batchSize: Math.max(1, Math.min(250, Number(request.nextUrl.searchParams.get("batch") || 100))),
      staleAfterHours: Math.max(1, Math.min(24 * 30, Number(request.nextUrl.searchParams.get("staleHours") || 24))),
    });
    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Property match profile backfill failed" },
      { status: 500 },
    );
  } finally {
    await guard.release();
  }
}
