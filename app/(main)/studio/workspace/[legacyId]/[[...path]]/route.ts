import { getHostOrigin } from "@/lib/auth/host-brand";
import { NextRequest, NextResponse } from "next/server";
import { cleanStudioLegacyPath } from "@/lib/studio/route-policy";

/**
 * Compatibility only: pre-Location links (`/studio/workspace/<old id>/…`). Studio's tenant
 * is the active Location, checked on the destination page, so the old ID selects nothing.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ legacyId: string; path?: string[] }> }) {
  const origin = getHostOrigin(request.headers.get("host"));
  if (!origin) return new NextResponse("Not Found", { status: 404 });
  const destination = cleanStudioLegacyPath((await params).path);
  if (!destination) return new NextResponse("Not Found", { status: 404 });
  const target = new URL(destination, origin);
  target.search = request.nextUrl.search;
  target.searchParams.delete("_rsc");
  return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST() {
  return NextResponse.json({ error: "Studio URLs have changed. Reload the page before submitting." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
