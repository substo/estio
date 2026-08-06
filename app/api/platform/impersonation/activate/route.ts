import { NextResponse } from "next/server";
import { activateCurrentImpersonation } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const context = await activateCurrentImpersonation();
    return NextResponse.json({ ok: true, expiresAt: context.sessionExpiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Master login is invalid or expired." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
