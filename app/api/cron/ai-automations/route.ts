import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { runAiAutomationCron } from "@/lib/ai/automation/hub";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("ai-automations");

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(400, 5.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: "locked" });
  }

  try {
    const startedAt = Date.now();
    const plannerOnly = request.nextUrl.searchParams.get("mode") === "plan";
    const stats = await runAiAutomationCron({
      plannerOnly,
      batchSize: Number(request.nextUrl.searchParams.get("batch") || 60),
    });

    return NextResponse.json({
      success: true,
      plannerOnly,
      durationMs: Date.now() - startedAt,
      ...stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "AI automation cron failed",
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
