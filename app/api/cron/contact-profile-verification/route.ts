import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { CronGuard } from "@/lib/cron/guard";
import { runContactProfileVerificationCron } from "@/lib/ai/contact-profile-verification/cron";
import { normalizeContactProfileVerificationBatchSize } from "@/lib/ai/contact-profile-verification/config";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("contact-profile-verification");

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
    const stats = await runContactProfileVerificationCron({
      locationId: String(request.nextUrl.searchParams.get("locationId") || "").trim() || undefined,
      batchSize: normalizeContactProfileVerificationBatchSize(request.nextUrl.searchParams.get("batch")),
    });
    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Contact profile verification cron failed" },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
