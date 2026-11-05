import "server-only";
import { getStudioAccess } from "./access";
import { studioDb } from "./studio-db";
/** Call after imported metadata is saved. Waiting requests are picked up by a later paired-device claim. */
export async function enqueueLibrarySummary(locationId: string, recordId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) throw new Error("Studio access denied.");
  return studioDb.call("studio_request_library_summary", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId });
}
