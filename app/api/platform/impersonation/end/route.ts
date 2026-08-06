import { NextResponse } from "next/server";
import { endCurrentImpersonation } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await endCurrentImpersonation();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Support access is invalid or already ended." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
