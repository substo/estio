"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { studioDestination, substoCrmDestination, substoStudioDestination } from "@/lib/auth/product-navigation";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
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

export async function openEstioStudioBusinessAction(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || access.brand !== "estio") redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, access.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect("/admin");
}

/** Open a Substo Location's Studio, attaching its workspace on first use. */
export async function openSubstoLocationStudioAction(formData: FormData) {
  if (await getRequestBrand() !== "substo") redirect("/studio");
  const locationId = String(formData.get("brandId") || "").trim();
  const destination = await substoStudioDestination(locationId);
  if (!destination) redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}

/** Select the workspace's current Location before entering its CRM; never trust a posted Location ID. */
export async function openSubstoStudioCrmAction(workspaceId: string) {
  if (await getRequestBrand() !== "substo") redirect("/studio/select?error=access");
  const destination = await substoCrmDestination(workspaceId);
  if (!destination) redirect("/studio/select?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}
