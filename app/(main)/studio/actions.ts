"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { studioDestination, substoCrmDestination, substoStudioDestination } from "@/lib/auth/product-navigation";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";

async function getRequestBrand() {
  return resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
}

export async function openEstioStudioLocation(formData: FormData) {
  if (await getRequestBrand() !== "estio") redirect("/studio/select?error=access");
  const locationId = String(formData.get("locationId") || "").trim();
  const destination = await studioDestination(locationId);
  if (!destination) redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}

/** Open a Substo Location's Studio. */
export async function openSubstoLocationStudioAction(formData: FormData) {
  if (await getRequestBrand() !== "substo") redirect("/studio");
  const locationId = String(formData.get("brandId") || "").trim();
  const destination = await substoStudioDestination(locationId);
  if (!destination) redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}

/** Enter the CRM of the Location Studio showed, after re-checking access to it. */
export async function openSubstoStudioCrmAction(locationId: string) {
  if (await getRequestBrand() !== "substo") redirect("/studio/select?error=access");
  const destination = await substoCrmDestination(locationId);
  if (!destination) redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}
