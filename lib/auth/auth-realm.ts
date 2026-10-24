import type { HostBrand } from "./host-brand";

/**
 * Clerk application ("identity realm") that owns a Business user. Mirrors the
 * Prisma `AuthRealm` enum. Equal email addresses in different realms are
 * different people: user resolution and linking never cross realms.
 */
export type AuthRealm = "estio" | "substo";

export const AUTH_REALMS: readonly AuthRealm[] = ["estio", "substo"];

/**
 * Realm for a verified host brand. Tenant hosts are Estio Clerk satellites
 * (see `getClerkSatelliteProps`), so they belong to the Estio realm.
 */
export function authRealmForHostBrand(brand: HostBrand): AuthRealm {
  return brand === "substo" ? "substo" : "estio";
}

/**
 * Realms whose users can be members of brands (Prisma locations). Both apps
 * have brands; which Business routes a realm may open is decided by the host
 * route firewall (`classifySubstoRoute`), not here.
 */
const BUSINESS_REALMS: ReadonlySet<AuthRealm> = new Set(["estio", "substo"]);

export function isBusinessRealm(realm: AuthRealm): boolean {
  return BUSINESS_REALMS.has(realm);
}

/** Unique selector for a user by Clerk ID within one realm. */
export function realmClerkIdWhere(realm: AuthRealm, clerkId: string) {
  return { authRealm_clerkId: { authRealm: realm, clerkId } };
}

/** Unique selector for a user by email within one realm. */
export function realmEmailWhere(realm: AuthRealm, email: string) {
  return { authRealm_email: { authRealm: realm, email } };
}

/**
 * Selector for a Business user by Clerk ID where no request host is
 * available (shared permission helpers, workers). Safe because Clerk IDs are
 * globally unique, so it matches only that Clerk user's own row, and only if
 * the row's realm has Business access.
 */
export function businessClerkIdWhere(clerkId: string) {
  return { clerkId, authRealm: { in: [...BUSINESS_REALMS] } };
}
