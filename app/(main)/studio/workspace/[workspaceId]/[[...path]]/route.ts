import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceTenant } from "@/lib/auth/tenant-context";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { cleanStudioLegacyPath } from "@/lib/studio/route-policy";

/** Compatibility only. Authorize the old storage key before selecting its real Location. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  const { workspaceId, path } = await params;
  const destination = cleanStudioLegacyPath(path);
  if (!destination) return new NextResponse("Not Found", { status: 404 });
  const resolution = await resolveWorkspaceTenant(workspaceId);
  if (!resolution?.location) return new NextResponse("Not Found", { status: 404 });
  const target = new URL(destination, request.url);
  target.search = request.nextUrl.search;
  target.searchParams.delete("_rsc");
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(ACTIVE_LOCATION_COOKIE, resolution.location.id, ACTIVE_LOCATION_COOKIE_OPTIONS);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST() {
  return NextResponse.json({ error: "Studio URLs have changed. Reload the page before submitting." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
