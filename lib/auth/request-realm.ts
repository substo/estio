import "server-only";

import { headers } from "next/headers";
import { authRealmForHostBrand, type AuthRealm } from "./auth-realm";
import { getHostBrandConfig, resolveHostBrand } from "./host-brand";

/**
 * Identity realm of the current request, from the exact host allowlist that
 * also selects the Clerk keys in middleware. Never derived from an email,
 * payload or client-supplied value.
 */
export async function getRequestAuthRealm(): Promise<AuthRealm> {
  return authRealmForHostBrand(resolveHostBrand((await headers()).get("host"), getHostBrandConfig()));
}
