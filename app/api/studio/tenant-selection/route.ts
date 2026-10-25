import { NextRequest, NextResponse } from "next/server";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { resolveWorkspaceTenant } from "@/lib/auth/tenant-context";

/** Last-used preference only: explicit routes and submitted tenant IDs remain authoritative. */
export async function POST(request: NextRequest) {
  const origin = getHostOrigin(request.headers.get("host"));
  if (!origin || request.headers.get("origin") !== origin) return new NextResponse("Forbidden", { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.workspaceId !== "string") return new NextResponse("Invalid selection", { status: 400 });
  const resolution = await resolveWorkspaceTenant(body.workspaceId);
  if (!resolution?.location) return new NextResponse("Forbidden", { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ACTIVE_LOCATION_COOKIE, resolution.location.id, ACTIVE_LOCATION_COOKIE_OPTIONS);
  return response;
}
