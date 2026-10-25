import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { substoCrmDestination, substoStudioDestination } from "@/lib/auth/product-navigation";

/** A native form POST deliberately leaves the router's cached auth/layout tree behind. */
export async function POST(request: NextRequest) {
  const origin = getHostOrigin(request.headers.get("host"));
  if (!origin || request.headers.get("origin") !== origin || await getRequestAuthRealm() !== "substo") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const product = form.get("product");
  const id = form.get(product === "crm" ? "workspaceId" : "brandId");
  if (!["crm", "studio"].includes(String(product)) || typeof id !== "string" || !id || id.length > 255) return new NextResponse("Invalid product selection", { status: 400 });
  const { userId } = await auth();
  if (!userId) {
    const signIn = new URL("/sign-in", origin);
    signIn.searchParams.set("redirect_url", product === "crm" ? "/admin" : "/studio");
    return NextResponse.redirect(signIn, 303);
  }
  const destination = product === "crm" ? await substoCrmDestination(id) : await substoStudioDestination(id);
  if (!destination) return NextResponse.redirect(new URL("/studio?error=access", origin), 303);
  const response = NextResponse.redirect(new URL(destination.path, origin), 303);
  response.cookies.set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
