import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { runAiRuntimeCron } from "@/lib/ai/runtime/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("ai-runtime");

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
    const plannerOnly = request.nextUrl.searchParams.get("mode") === "plan";
    const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim() || undefined;
    const sourceRaw = String(request.nextUrl.searchParams.get("source") || "automation").trim();
    const source = ["automation", "semi_auto", "manual", "mission"].includes(sourceRaw)
      ? sourceRaw as "automation" | "semi_auto" | "manual" | "mission"
      : "automation";

    const stats = await runAiRuntimeCron({
      plannerOnly,
      locationId,
      batchSize: Math.max(1, Math.min(300, Number(request.nextUrl.searchParams.get("batch") || 80))),
      source,
    });

    return NextResponse.json({
      success: true,
      plannerOnly,
      source,
      durationMs: Date.now() - startedAt,
      ...stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "AI runtime cron failed",
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}

