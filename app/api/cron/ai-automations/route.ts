import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const source = String(request.nextUrl.searchParams.get("source") || "automation");
  return NextResponse.json(
    {
      success: false,
      code: "CRON_ENDPOINT_DEPRECATED",
      error: "Deprecated endpoint. Use /api/cron/ai-runtime.",
      replacement: `/api/cron/ai-runtime?source=${encodeURIComponent(source)}`,
    },
    { status: 410 }
  );
}
