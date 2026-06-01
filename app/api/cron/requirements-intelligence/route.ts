import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { CronGuard } from "@/lib/cron/guard";
import { runRequirementsIntelligenceCron } from "@/lib/ai/requirements-intelligence/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("requirements-intelligence");

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
    const stats = await runRequirementsIntelligenceCron({
      locationId: String(request.nextUrl.searchParams.get("locationId") || "").trim() || undefined,
      batchSize: Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get("batch") || 40))),
    });
    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Requirements intelligence cron failed" },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
