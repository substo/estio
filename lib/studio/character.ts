import "server-only";
import { auth } from "@clerk/nextjs/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStudioAccess } from "./access";
import { readAvatarBytes } from "./avatar-policy";
import { removeAvatar, setAvatar } from "./avatar";
import { characterManifestKey, characterPhotoKey, readManifest, type CharacterManifest, type CharacterPhoto } from "./character-profile";
import { StudioCommandError } from "./command-error";
import { MAX_CHARACTER_PHOTOS, PHOTO_ROLES, type CharacterProfile, type PhotoRole } from "./images/character-sheet";
import { createStudioR2Store, readStudioR2Config, type StudioR2Store } from "./media-r2";

type Store = Pick<StudioR2Store, "uploadCreateOnly" | "deleteObject" | "presignRead">;
async function ownAccess(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("Your character can only be changed from your own account.", 403);
  return access;
}
function storeOrThrow(store?: Store): Store {
  const config = readStudioR2Config();
  const s = store ?? (config ? createStudioR2Store(config) : null);
  if (!s) throw new StudioCommandError("Media storage is not configured.", 503);
  return s;
}
async function loadManifest(store: Store, key: string): Promise<CharacterManifest> {
  try {
    const url = await store.presignRead({ key, contentType: "application/json", contentDisposition: "inline" });
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return readManifest(null);
    return readManifest(await r.json());
  } catch { return readManifest(null); }
}
/** Storage writes are create-only, so a replace deletes first. The manifest is small and rewritten whole. */
async function writeManifest(store: Store, key: string, manifest: CharacterManifest) {
  const bytes = Buffer.from(JSON.stringify(manifest)), dir = await mkdtemp(join(tmpdir(), "studio-character-"));
  try { const path = join(dir, "profile.json"); await writeFile(path, bytes, { mode: 0o600 }); await store.deleteObject(key); await store.uploadCreateOnly({ key, filePath: path, byteSize: bytes.length, contentType: "application/json" }); }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export interface CharacterView { photos: Array<CharacterPhoto & { url: string }>; profile: CharacterProfile }
/** The signed-in user's own character, never anyone else's. Photo links are short-lived private reads. */
export async function getCharacter(locationId: string, deps: { store?: Store } = {}): Promise<CharacterView | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const config = readStudioR2Config(), store = deps.store ?? (config ? createStudioR2Store(config) : null);
  if (!store) return { photos: [], profile: { aspects: [] } };
  const manifest = await loadManifest(store, characterManifestKey(access.locationId, access.userId));
  const photos = await Promise.all(manifest.photos.map(async p => ({ ...p, url: await store.presignRead({ key: characterPhotoKey(access.locationId, access.userId, p.n), contentType: p.contentType, contentDisposition: "inline" }) })));
  return { photos, profile: manifest.profile };
}

export async function saveCharacterPhoto(locationId: string, n: number, role: string, file: File, deps: { store?: Store } = {}) {
  const access = await ownAccess(locationId);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHARACTER_PHOTOS) throw new StudioCommandError(`Choose one of the ${MAX_CHARACTER_PHOTOS} photo slots.`);
  if (!(PHOTO_ROLES as readonly string[]).includes(role)) throw new StudioCommandError("Choose what this photo shows.");
  const bytes = Buffer.from(await file.arrayBuffer()), checked = readAvatarBytes(bytes);
  if (!checked.ok) throw new StudioCommandError(checked.error);
  const store = storeOrThrow(deps.store), photoKey = characterPhotoKey(access.locationId, access.userId, n), manifestKey = characterManifestKey(access.locationId, access.userId);
  const dir = await mkdtemp(join(tmpdir(), "studio-character-"));
  try {
    const path = join(dir, "photo"); await writeFile(path, bytes, { mode: 0o600 });
    await store.deleteObject(photoKey); await store.uploadCreateOnly({ key: photoKey, filePath: path, byteSize: bytes.length, contentType: checked.contentType });
    const manifest = await loadManifest(store, manifestKey);
    const photo: CharacterPhoto = { n, role: role as PhotoRole, contentType: checked.contentType, byteSize: bytes.length, updatedAt: new Date().toISOString() };
    await writeManifest(store, manifestKey, { ...manifest, photos: [...manifest.photos.filter(p => p.n !== n), photo].sort((a, b) => a.n - b.n) });
    // Slot 1 is also the stand-in picture the video flow already uses, so nothing there changes.
    if (n === 1) await setAvatar(locationId, file);
  } catch (error) { await store.deleteObject(photoKey).catch(() => {}); throw error; }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function removeCharacterPhoto(locationId: string, n: number, deps: { store?: Store } = {}) {
  const access = await ownAccess(locationId);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHARACTER_PHOTOS) throw new StudioCommandError("Unknown photo slot.");
  const store = storeOrThrow(deps.store), manifestKey = characterManifestKey(access.locationId, access.userId);
  const manifest = await loadManifest(store, manifestKey);
  await writeManifest(store, manifestKey, { ...manifest, photos: manifest.photos.filter(p => p.n !== n) });
  await store.deleteObject(characterPhotoKey(access.locationId, access.userId, n)).catch(() => {});
  if (n === 1) await removeAvatar(locationId).catch(() => {});
}

export async function saveCharacterProfile(locationId: string, profile: CharacterProfile, deps: { store?: Store } = {}) {
  const access = await ownAccess(locationId);
  const store = storeOrThrow(deps.store), manifestKey = characterManifestKey(access.locationId, access.userId);
  await writeManifest(store, manifestKey, { ...(await loadManifest(store, manifestKey)), profile });
}

/** For the claim hook and the sheet pages: one person's manifest, read with the given store. */
export const readCharacterManifest = (store: Pick<StudioR2Store, "presignRead">, locationId: string, userId: string) => loadManifest(store as Store, characterManifestKey(locationId, userId));
