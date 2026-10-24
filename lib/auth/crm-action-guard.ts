import "server-only";

import { getRequestAuthRealm } from "./request-realm";
import { isSubstoCrmAction } from "./substo-crm-actions";

/** Server Actions can be posted to any page: hiding/blocking their original URL is insufficient. */
export async function assertCrmActionAllowed(module: string, action: string): Promise<void> {
  if (await getRequestAuthRealm() !== "substo") return;
  if (!isSubstoCrmAction(module, action)) throw new Error("This feature is unavailable in this app.");
  const { resolveActiveLocation } = await import("./active-location");
  const active = await resolveActiveLocation();
  if (active.status !== "authorized" || active.location?.authRealm !== "substo") {
    throw new Error("Unauthorized");
  }
}

export async function assertGenericContactInput(input: Record<string, unknown>): Promise<void> {
  if (await getRequestAuthRealm() !== "substo") return;
  const { hasPropertyContactInput } = await import("./substo-crm-policy");
  if (hasPropertyContactInput(input)) throw new Error("Property workflows are unavailable in this app.");
}
