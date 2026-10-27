import { getHostOrigin } from "@/lib/auth/host-brand";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceTenant } from "@/lib/auth/tenant-context";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { cleanStudioLegacyPath } from "@/lib/studio/route-policy";
import { isStudioProviderUnavailable } from "@/lib/studio/rest";

/** Compatibility only. Authorize the old storage key before selecting its real Location. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  const origin = getHostOrigin(request.headers.get("host"));
  if (!origin) return new NextResponse("Not Found", { status: 404 });
  const { workspaceId, path } = await params;
  const destination = cleanStudioLegacyPath(path);
  if (!destination) return new NextResponse("Not Found", { status: 404 });
  let resolution;
  try { resolution = await resolveWorkspaceTenant(workspaceId); }
  catch (error) {
    // The old key cannot be checked while Studio's database is restricted; select nothing.
    if (!isStudioProviderUnavailable(error)) throw error;
    return NextResponse.redirect(new URL("/studio", origin), { status: 303, headers: { "Cache-Control": "private, no-store" } });
  }
  if (!resolution?.location) return new NextResponse("Not Found", { status: 404 });
  const target = new URL(destination, origin);
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
