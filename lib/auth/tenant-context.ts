import "server-only";

import { cache } from "react";
import { getRequestAuthRealm } from "./request-realm";
import { resolveActiveLocation, validateActiveLocationSelection } from "./active-location";

/**
 * The tenant for CRM and Studio: the active Location (or an explicitly selected one),
 * checked against the account's membership in this app. Studio data is keyed by the
 * same Location ID, so there is nothing else to resolve.
 */
export function resolveTenantContext(input: { locationId?: string } = {}) {
  return resolveTenantContextCached(input.locationId);
}

/** Cached per request by its primitive input (the layout and the page both resolve it). */
const resolveTenantContextCached = cache(async (locationId: string | undefined) => {
  const realm = await getRequestAuthRealm();
  if (realm !== "estio" && realm !== "substo") return null;
  const resolution = locationId !== undefined ? await validateActiveLocationSelection(locationId) : await resolveActiveLocation();
  if (locationId !== undefined && resolution.status !== "authorized") return null;
  return { app: realm, resolution, locationId: resolution.status === "authorized" ? resolution.location?.id ?? null : null };
});
