"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { substoCrmDestination, substoStudioDestination } from "@/lib/auth/product-navigation";
import db from "@/lib/db";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { getEstioStudioLocationAccess, getStudioWorkspaceAccess } from "@/lib/studio/access";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { ensureEstioStudioWorkspace } from "@/lib/studio/supabase-service";
import { createBrand } from "@/lib/brands/brand-service";
import { prepareCurrentSubstoUser } from "@/lib/brands/substo-brands";

async function getRequestBrand() {
  return resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
}

export async function openEstioStudioLocation(formData: FormData) {
  const locationId = String(formData.get("locationId") || "").trim();
  const access = await getEstioStudioLocationAccess(locationId);
  if (!access) redirect("/studio?error=access");

  (await cookies()).set(ACTIVE_LOCATION_COOKIE, access.location.id, ACTIVE_LOCATION_COOKIE_OPTIONS);
  const workspace = await ensureEstioStudioWorkspace({
    id: access.location.id,
    name: access.location.name,
  });
  redirect(`/studio/workspace/${workspace.id}`);
}

export async function openEstioStudioBusinessAction(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || access.brand !== "estio") redirect("/studio?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, access.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect("/admin");
}

/** Open a Substo brand's Studio, attaching its workspace on first use. */
export async function openSubstoBrandStudioAction(formData: FormData) {
  if (await getRequestBrand() !== "substo") redirect("/studio");
  const brandId = String(formData.get("brandId") || "").trim();
  const destination = await substoStudioDestination(brandId);
  if (!destination) redirect("/studio?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}

/** Create another brand; the creator becomes its admin. */
export async function createSubstoBrandAction(formData: FormData) {
  if (await getRequestBrand() !== "substo") redirect("/studio");
  const prepared = await prepareCurrentSubstoUser();
  if (!prepared) redirect("/sign-in?redirect_url=%2Fstudio");
  const brandId = await createBrand(db, prepared.user.id, formData.get("name"));
  if (!brandId) redirect("/studio?choose=1&error=brand");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, brandId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect("/studio");
}

/** Select the workspace's current brand before entering its CRM; never trust a posted brand ID. */
export async function openSubstoStudioCrmAction(workspaceId: string) {
  if (await getRequestBrand() !== "substo") redirect("/studio?error=access");
  const destination = await substoCrmDestination(workspaceId);
  if (!destination) redirect("/studio?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, destination.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect(destination.path);
}
