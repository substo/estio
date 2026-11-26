import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { binPurgesAt, type BinKind, type BinListItem } from "./bin-policy";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireMember(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("Deleting needs your own authorized account.", 403);
  return access;
}
const identity = (a: { locationId: string; app: string; userId: string }) => ({ p_location_id: a.locationId, p_actor_app: a.app, p_clerk_user_id: a.userId });

export async function moveToBin(locationId: string, kind: BinKind, id: string): Promise<boolean> {
  const access = await requireMember(locationId);
  if (!uuid.test(id)) throw new StudioCommandError("Invalid item.");
  return studioDb.call<boolean>("studio_bin_item", { ...identity(access), p_kind: kind, p_id: id });
}

export async function restoreFromBin(locationId: string, kind: BinKind, id: string): Promise<boolean> {
  const access = await requireMember(locationId);
  if (!uuid.test(id)) throw new StudioCommandError("Invalid item.");
  try { return await studioDb.call<boolean>("studio_restore_bin_item", { ...identity(access), p_kind: kind, p_id: id }); }
  catch (error) {
    if (error instanceof StudioDbError && error.code === "BN002") throw new StudioCommandError("Restore the piece this video belongs to first.");
    throw error;
  }
}

export async function listBin(locationId: string): Promise<BinListItem[] | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const rows = await studioDb.call<Array<Omit<BinListItem, "purgesAt">>>("studio_list_bin", identity(access));
  return rows.map(r => ({ ...r, purgesAt: binPurgesAt(r.deletedAt) }));
}
