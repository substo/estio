import "server-only";
import { getPlatformProfile } from "../platform/profile";
import { getStudioWorkspaceAccess } from "./access";
import { StudioCommandError } from "./command-error";
/** Derive authority for paid generation and explicit draft application. */
export async function requireOwnStudioCommandWorkspace(workspaceId: string) {
  const [profile, access] = await Promise.all([getPlatformProfile(), getStudioWorkspaceAccess(workspaceId)]);
  if (!profile || !access || profile.userId !== access.userId || profile.brand !== access.brand) throw new StudioCommandError("This command requires your own authorized workspace account.", 403);
  return access;
}
