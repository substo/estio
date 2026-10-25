import { NextRequest, NextResponse } from "next/server";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { studioDestination } from "@/lib/auth/product-navigation";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS, validateActiveLocationSelection } from "@/lib/auth/active-location";

export async function POST(request: NextRequest) {
  const origin = getHostOrigin(request.headers.get("host"));
  if (!origin || request.headers.get("origin") !== origin) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const locationId = form.get("locationId");
  const product = form.get("product");
  if (typeof locationId !== "string" || locationId.length > 255 || !["studio", "crm", "team"].includes(String(product))) return new NextResponse("Invalid selection", { status: 400 });
  let destination;
  if (product === "studio") destination = await studioDestination(locationId);
  else {
    const resolution = await validateActiveLocationSelection(locationId);
    if (resolution.status === "authorized" && resolution.location) destination = { locationId: resolution.location.id, path: product === "team" ? "/admin/team" : "/admin" };
  }
  if (!destination) return NextResponse.redirect(new URL("/studio?error=access", origin), 303);
  const response = NextResponse.redirect(new URL(destination.path, origin), 303);
  response.cookies.set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
