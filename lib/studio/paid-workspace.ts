import "server-only";
import { getPlatformProfile } from "../platform/profile";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
/** Derive authority for paid generation and explicit draft application. */
export async function requireOwnStudioCommandLocation(locationId: string) {
  const [profile, access] = await Promise.all([getPlatformProfile(), getStudioAccess(locationId)]);
  if (!profile || !access || profile.userId !== access.userId || profile.brand !== access.app) throw new StudioCommandError("This command requires your own authorized workspace account.", 403);
  return access;
}
