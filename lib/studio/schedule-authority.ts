import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { intersectAuthorizedLocations, scopeDirectLocationsForSession } from "../auth/active-location-policy";
import { queryPath } from "./rest-client";
export type ScheduleRest = <T>(path: string, init?: RequestInit) => Promise<T>;
/** Same direct-location intersection/platform-admin scope as an own Estio session; optionally require a location role. */
export async function currentEstioScheduleAuthority(userId: string, locationId: string, requiredRole?: "ADMIN"): Promise<boolean> {
  const { default: db } = await import("../db");
  // Estio actors only: the Business user must be in the estio realm.
  const user = await db.user.findUnique({ where: { authRealm_clerkId: { authRealm: "estio", clerkId: userId } }, select: { clerkId: true, platformRole: true,
    locations: { select: { id: true, name: true, isPlatformMaster: true } },
    locationRoles: { select: { locationId: true, role: true, contactAccessScope: true } } } });
  if (!user || user.clerkId !== userId) return false;
  return scopeDirectLocationsForSession(intersectAuthorizedLocations({ connectedLocations: user.locations, roles: user.locationRoles }),
    { platformRole: user.platformRole, isImpersonating: false }).some(location => location.id === locationId && (!requiredRole || location.role === requiredRole));
}
export async function authorizeEstioSchedule(rest: ScheduleRest, locationId: string, userId: string,
  check = currentEstioScheduleAuthority): Promise<boolean> {
  if (await isPlatformProfileDeleted(rest, "estio", userId)) return false;
  const [workspace] = await rest<Array<{ brand: string; estio_location_id: string | null }>>(queryPath("studio_workspaces", {
    select: "brand,estio_location_id", id: `eq.${locationId}`, limit: "1" }));
  return !!workspace && workspace.brand === "estio" && !!workspace.estio_location_id && check(userId, workspace.estio_location_id);
}
/** Substo is checked under SQL membership lock; Estio resides in Business. */
export async function authorizeScheduledTextJob(rest: ScheduleRest, locationId: string, jobId: string,
  check = currentEstioScheduleAuthority): Promise<boolean> {
  const [execution] = await rest<Array<{ actor_app: string; created_by_clerk_user_id: string }>>(queryPath("studio_schedule_executions", {
    select: "actor_app,created_by_clerk_user_id", location_id: `eq.${locationId}`, job_id: `eq.${jobId}`, activation_token: "not.is.null", limit: "1" }));
  if (!execution || execution.actor_app === "substo") return true;
  return execution.actor_app === "estio" && authorizeEstioSchedule(rest, locationId, execution.created_by_clerk_user_id, check);
}
