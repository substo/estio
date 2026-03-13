import { NextRequest, NextResponse } from "next/server";

/**
 * Deprecated compatibility endpoint.
 *
 * All AI runtime scheduling now runs through /api/cron/ai-runtime.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const source = String(request.nextUrl.searchParams.get("source") || "automation");
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      code: "CRON_ENDPOINT_DEPRECATED",
      error: "Deprecated endpoint. Use /api/cron/ai-runtime.",
      replacement: `/api/cron/ai-runtime?source=${encodeURIComponent(source)}`,
    },
    { status: 410 }
  );
}
