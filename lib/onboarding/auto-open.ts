import { cookies } from "next/headers";
import { onboardingActor } from "./actor";
import { onboardingOpenModeFor } from "./service";
import { deferredFor, ONBOARDING_LATER_COOKIE, onboardingPath } from "./entry";

/**
 * Where a landing screen should send this person instead: the onboarding screen for an admin whose business profile
 * isn't finished, unless they chose "Later" for this Location in this browser session. Never throws: a failure here
 * must not block the home screen.
 */
export async function onboardingRedirectFor(locationId: string, product: "crm" | "studio"): Promise<string | null> {
  try {
    if (deferredFor((await cookies()).get(ONBOARDING_LATER_COOKIE)?.value, locationId)) return null;
    const actor = await onboardingActor(locationId);
    if (!actor) return null;
    return await onboardingOpenModeFor(actor) === "none" ? null : onboardingPath(product);
  } catch { return null; }
}
