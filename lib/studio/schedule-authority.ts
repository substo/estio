import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { intersectAuthorizedLocations, scopeDirectLocationsForSession } from "../auth/active-location-policy";
import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
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
export async function authorizeEstioSchedule(db: StudioDb, locationId: string, userId: string,
  check = currentEstioScheduleAuthority): Promise<boolean> {
  if (await isPlatformProfileDeleted(db, "estio", userId)) return false;
  return check(userId, locationId);
}
/** Substo is checked under SQL membership lock; Estio resides in Business. */
export async function authorizeScheduledTextJob(db: StudioDb, locationId: string, jobId: string,
  check = currentEstioScheduleAuthority): Promise<boolean> {
  const execution = await db.one<{ actor_app: string; created_by_clerk_user_id: string }>(Prisma.sql`
    select actor_app,created_by_clerk_user_id from studio.studio_schedule_executions
    where location_id = ${locationId} and job_id = ${jobId}::uuid and activation_token is not null`);
  if (!execution || execution.actor_app === "substo") return true;
  return execution.actor_app === "estio" && authorizeEstioSchedule(db, locationId, execution.created_by_clerk_user_id, check);
}
