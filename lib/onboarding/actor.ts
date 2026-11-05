import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "@/lib/studio/access";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";
import type { Actor } from "./service";

/** The signed-in person acting on the active Location's onboarding, or null without Location access. */
export async function onboardingActor(locationId: string): Promise<Actor | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const [session, dbUserId] = await Promise.all([auth(), resolveAuthenticatedDbUserId()]);
  return { locationId, app: access.app === "substo" ? "substo" : "estio", role: access.role, impersonating: Boolean(session.actor), clerkUserId: access.userId, dbUserId };
}
