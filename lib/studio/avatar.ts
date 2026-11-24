import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStudioAccess } from "./access";
import { avatarObjectKey, readAvatarBytes } from "./avatar-policy";
import { attachStoryboardAvatar } from "./avatar-claim";
import { StudioCommandError } from "./command-error";
import { createStudioR2Store, readStudioR2Config, type StudioR2Store } from "./media-r2";
import { studioDb } from "./studio-db";

async function requireOwnAccess(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("Your photo can only be changed from your own account.", 403);
  return access;
}
const identity = (a: { locationId: string; app: string; userId: string }) => ({ p_location_id: a.locationId, p_actor_app: a.app, p_clerk_user_id: a.userId });

export interface AvatarState { contentType: string; byteSize: number; updatedAt: string }
/** The signed-in user's own photo, never anyone else's. */
export async function getAvatarState(locationId: string): Promise<AvatarState | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  return studioDb.call<AvatarState | null>("studio_get_avatar", identity(access)).catch(() => null);
}

/** Store the photo in private storage under a derived key, then record its metadata. Replacing deletes the old object first because storage writes are create-only. */
export async function setAvatar(locationId: string, file: File, deps: { store?: Pick<StudioR2Store, "uploadCreateOnly" | "deleteObject"> } = {}): Promise<{ contentType: string }> {
  const access = await requireOwnAccess(locationId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = readAvatarBytes(bytes);
  if (!checked.ok) throw new StudioCommandError(checked.error);
  const config = readStudioR2Config();
  const store = deps.store ?? (config ? createStudioR2Store(config) : null);
  if (!store) throw new StudioCommandError("Media storage is not configured.", 503);
  const key = avatarObjectKey(access.locationId, access.userId), dir = await mkdtemp(join(tmpdir(), "studio-avatar-"));
  try {
    const path = join(dir, "photo");
    await writeFile(path, bytes, { mode: 0o600 });
    await store.deleteObject(key);
    await store.uploadCreateOnly({ key, filePath: path, byteSize: bytes.length, contentType: checked.contentType });
    await studioDb.call("studio_set_avatar", { ...identity(access), p_content_type: checked.contentType, p_byte_size: bytes.length, p_sha256: createHash("sha256").update(bytes).digest("hex") });
    return { contentType: checked.contentType };
  } catch (error) {
    await store.deleteObject(key).catch(() => {});   // never leave a stored photo that has no record
    throw error;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function removeAvatar(locationId: string, deps: { store?: Pick<StudioR2Store, "deleteObject"> } = {}): Promise<void> {
  const access = await requireOwnAccess(locationId);
  await studioDb.call("studio_remove_avatar", identity(access));
  const config = readStudioR2Config();
  const store = deps.store ?? (config ? createStudioR2Store(config) : null);
  await store?.deleteObject(avatarObjectKey(access.locationId, access.userId)).catch(() => {});
}

/** Claim wiring: the real storage and database behind the pure attach step in avatar-claim.ts. */
export async function withStoryboardAvatar(jobs: unknown): Promise<unknown> {
  if (!Array.isArray(jobs) || !jobs.some(j => j?.kind === "studio.video_assemble")) return jobs;
  const config = readStudioR2Config();
  return attachStoryboardAvatar(jobs, config ? createStudioR2Store(config) : null,
    (locationId, userId) => studioDb.call<{ contentType: string; byteSize: number } | null>("studio_job_avatar", { p_location_id: locationId, p_clerk_user_id: userId }));
}
