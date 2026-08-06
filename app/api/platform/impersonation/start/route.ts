import { NextResponse } from "next/server";
import { startImpersonation } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const result = await startImpersonation({
      targetUserId: String(body.targetUserId || ""),
      locationId: String(body.locationId || ""),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to log in as this user.";
    const status = message.startsWith("Not authorized") ? 404 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
