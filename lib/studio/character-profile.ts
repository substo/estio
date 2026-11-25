import { createHash } from "node:crypto";
import { ASPECT_KEYS, MAX_CHARACTER_PHOTOS, PHOTO_ROLES, applyProfileEdits, type CharacterAspect, type CharacterProfile, type PhotoRole } from "./images/character-sheet";
import { AVATAR_TYPES, type AvatarType } from "./avatar-policy";

/** What is kept about a person's character: up to five photos (each with a role) and the character card. Rules only: no storage, no network. */
export interface CharacterPhoto { n: number; role: PhotoRole; contentType: AvatarType; byteSize: number; updatedAt: string }
export interface CharacterManifest { photos: CharacterPhoto[]; profile: CharacterProfile }
export const EMPTY_MANIFEST: CharacterManifest = { photos: [], profile: { aspects: [] } };

/** Derived from the Location and a hash of the user id, never from user input; the first photo is also the stand-in picture the video flow already uses. */
const folder = (locationId: string, userId: string) => `${locationId}/character/${createHash("sha256").update(userId).digest("hex").slice(0, 40)}`;
export const characterPhotoKey = (locationId: string, userId: string, n: number) => `${folder(locationId, userId)}/photo-${n}`;
export const characterManifestKey = (locationId: string, userId: string) => `${folder(locationId, userId)}/profile.json`;

const isoOk = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
/** Anything not recognised is dropped, not trusted: the file is read back from storage. */
export function readManifest(value: unknown): CharacterManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { photos: [], profile: { aspects: [] } };
  const raw = value as Record<string, unknown>;
  const photos: CharacterPhoto[] = [];
  for (const p of Array.isArray(raw.photos) ? raw.photos.slice(0, 20) : []) {
    const r = p as Record<string, unknown>;
    if (Number.isInteger(r?.n) && (r.n as number) >= 1 && (r.n as number) <= MAX_CHARACTER_PHOTOS && !photos.some(x => x.n === r.n)
      && (PHOTO_ROLES as readonly unknown[]).includes(r.role) && (AVATAR_TYPES as readonly unknown[]).includes(r.contentType) && Number.isFinite(r.byteSize) && isoOk(r.updatedAt))
      photos.push({ n: r.n as number, role: r.role as PhotoRole, contentType: r.contentType as AvatarType, byteSize: r.byteSize as number, updatedAt: r.updatedAt as string });
  }
  const prof = (raw.profile ?? {}) as Record<string, unknown>;
  const aspects: CharacterAspect[] = [];
  for (const a of Array.isArray(prof.aspects) ? prof.aspects.slice(0, 12) : []) {
    const r = a as Record<string, unknown>;
    if ((ASPECT_KEYS as readonly unknown[]).includes(r?.key) && typeof r.value === "string" && typeof r.locked === "boolean" && !aspects.some(x => x.key === r.key)) aspects.push({ key: r.key as CharacterAspect["key"], value: r.value.slice(0, 200), locked: r.locked });
  }
  const notes = typeof prof.notes === "string" ? prof.notes.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  return { photos: photos.sort((a, b) => a.n - b.n), profile: { aspects, ...(notes ? { notes } : {}) } };
}

/** The profile the form sends: the same cleaning the agent's edits get (known aspects only, short values, no duplicates). */
export function cleanProfile(input: { aspects?: unknown; notes?: unknown }): CharacterProfile {
  const aspects = Array.isArray(input.aspects) ? input.aspects.slice(0, 12) : [];
  const edits = aspects.flatMap(a => { const r = a as Record<string, unknown>; return typeof r?.key === "string" && typeof r.value === "string" && r.value.trim() ? [{ op: "set" as const, key: r.key as CharacterAspect["key"], value: r.value, locked: r.locked === true }] : []; });
  return applyProfileEdits({ aspects: [] }, [...edits, ...(typeof input.notes === "string" && input.notes.trim() ? [{ op: "notes" as const, value: input.notes }] : [])]);
}
/** Photos in the order they should be used as references: the face first, then the angle, the body, the outfit. */
export function referenceOrder(photos: CharacterPhoto[]): CharacterPhoto[] {
  const rank: Record<PhotoRole, number> = { "face-front": 0, "face-angle": 1, "full-body": 2, outfit: 3, other: 4 };
  return [...photos].sort((a, b) => rank[a.role] - rank[b.role] || a.n - b.n);
}
