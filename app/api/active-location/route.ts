import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  ACTIVE_LOCATION_COOKIE,
  ACTIVE_LOCATION_COOKIE_OPTIONS,
  validateActiveLocationSelection,
} from "@/lib/auth/active-location";

function safeReturnTo(value: unknown): string {
  const candidate = typeof value === "string" ? value : "";
  return candidate === "/admin" || candidate.startsWith("/admin/") ? candidate : "/admin";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  }

  const isJson = request.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await request.json() : Object.fromEntries(await request.formData());
  const locationId = typeof body.locationId === "string" ? body.locationId : "";
  const returnTo = safeReturnTo(body.returnTo);
  const resolution = await validateActiveLocationSelection(locationId);

  if (resolution.status !== "authorized" || resolution.location?.id !== locationId) {
    const status = resolution.status === "unauthenticated" ? 401 : 403;
    return isJson
      ? NextResponse.json({ ok: false, error: "You do not have access to that location." }, { status })
      : NextResponse.redirect(new URL(`/select-location?error=access`, request.url), 303);
  }

  revalidatePath("/admin", "layout");
  const response = isJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(ACTIVE_LOCATION_COOKIE, resolution.location.id, ACTIVE_LOCATION_COOKIE_OPTIONS);
  return response;
}
