import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { characterSheetKey, referenceOrder, characterPhotoKey, SHEET_FILE } from "./character-profile";
import { getCharacter, readCharacterManifest } from "./character";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import type { SheetKind } from "./images/character-sheet";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { studioDb } from "./studio-db";

const messages: Record<string, string> = {
  CS001: "Choose a sheet to draw.", CS002: "Your character card is too long. Shorten it and try again.",
  CS011: "Pair a Mac in Setup to draw sheets. Nothing was sent to a paid service.", CS012: "Turn Mac processing on in Setup to draw sheets.",
  CS013: "Your Mac is not ready: it needs Codex signed in with ChatGPT. Check Setup, then try again.", CS014: "Update the Studio companion on your Mac (it cannot draw sheets yet).",
};
const identity = (a: { locationId: string; app: string; userId: string }) => ({ p_location_id: a.locationId, p_actor_app: a.app, p_clerk_user_id: a.userId });
const uuid = /^[0-9a-f-]{36}$/i;

export interface SheetView { jobId: string; sheet: SheetKind; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; error: string | null; files: Array<{ name: string; url: string }>; createdAt: string; finishedAt: string | null }

/** Ask the signed-in user's own Mac to draw one sheet from their photos and card. */
export async function requestCharacterSheet(locationId: string, sheet: SheetKind): Promise<{ jobId: string; reused: boolean }> {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("Sheets can only be drawn from your own account.", 403);
  const character = await getCharacter(locationId);
  if (!character?.photos.length) throw new StudioCommandError("Add at least one photo of yourself first.");
  try {
    const r = await studioDb.call<{ jobId: string; reused: boolean }>("studio_request_character_sheet", { ...identity(access), p_sheet: sheet, p_profile: { aspects: character.profile.aspects, ...(character.profile.notes ? { notes: character.profile.notes } : {}) } });
    return { jobId: r.jobId, reused: Boolean(r.reused) };
  } catch (error) {
    const text = error instanceof StudioDbError && error.code ? messages[error.code] : undefined;
    if (text) throw new StudioCommandError(text);
    throw error;
  }
}

/** The user's latest job per sheet, with private reads for finished pictures. Keys are derived from the job id, never from what the Mac reported. */
export async function getCharacterSheets(locationId: string): Promise<SheetView[]> {
  const access = await getStudioAccess(locationId);
  if (!access) return [];
  const rows = await studioDb.call<Array<{ jobId: string; sheet: SheetKind; status: SheetView["status"]; files: unknown; error: string | null; createdAt: string; finishedAt: string | null }>>("studio_character_sheet_state", identity(access)).catch(() => []);
  const config = readStudioR2Config(), store = config ? createStudioR2Store(config) : null;
  return Promise.all(rows.filter(r => uuid.test(r.jobId) && r.sheet !== ("storyboard" as string)).map(async r => {
    const names = Array.isArray(r.files) ? r.files.filter((f): f is string => typeof f === "string" && SHEET_FILE.test(f)) : [];
    const files = store && r.status === "succeeded" ? await Promise.all(names.map(async name => ({ name, url: await store.presignRead({ key: characterSheetKey(access.locationId, access.userId, r.jobId, name), contentType: "image/png", contentDisposition: "inline" }) }))) : [];
    return { jobId: r.jobId, sheet: r.sheet, status: r.status, error: r.error, files, createdAt: r.createdAt, finishedAt: r.finishedAt };
  }));
}

const SIGNED_SECONDS = 3600;
type Store = NonNullable<ReturnType<typeof createStudioR2Store>>;
/** Private links to this person's latest finished turnaround and face sheets (none when there are none or the lookup fails). */
async function latestSheetLinks(store: Store, locationId: string, userId: string): Promise<Array<{ name: string; url: string }>> {
  try {
    const rows = await studioDb.call<Array<{ sheet: string; jobId: string }>>("studio_job_character_sheets", { p_location_id: locationId, p_clerk_user_id: userId });
    return await Promise.all(rows.filter(r => uuid.test(r.jobId) && (r.sheet === "turnaround" || r.sheet === "face")).slice(0, 2).map(async r => ({
      name: `character-${r.sheet}.png`, url: await store.presignWorkerRead(characterSheetKey(locationId, userId, r.jobId, "sheet-1.png"), SIGNED_SECONDS) })));
  } catch { return []; }
}

/** Claim time: give the sheet job's own Mac private links to this person's photos (face first, at most three) and one upload link for the picture. Never stored in the job. */
export async function withCharacterSheetFiles(jobs: unknown): Promise<unknown> {
  if (!Array.isArray(jobs) || !jobs.some(j => j?.kind === "studio.character_sheet")) return jobs;
  const config = readStudioR2Config();
  if (!config) return jobs;
  const store = createStudioR2Store(config);
  return Promise.all(jobs.map(async raw => {
    const job = raw as { kind?: unknown; id?: unknown; location_id?: unknown; created_by_clerk_user_id?: unknown; payload?: Record<string, unknown> };
    if (job?.kind !== "studio.character_sheet" || typeof job.id !== "string" || !uuid.test(job.id) || typeof job.location_id !== "string" || typeof job.created_by_clerk_user_id !== "string") return raw;
    try {
      const manifest = await readCharacterManifest(store, job.location_id, job.created_by_clerk_user_id);
      const photos = await Promise.all(referenceOrder(manifest.photos).slice(0, 3).map(async p => ({
        name: `photo-${p.n}.${p.contentType === "image/png" ? "png" : p.contentType === "image/webp" ? "webp" : "jpg"}`,
        url: await store.presignWorkerRead(characterPhotoKey(job.location_id as string, job.created_by_clerk_user_id as string, p.n), SIGNED_SECONDS) })));
      const storyboard = job.payload?.sheet === "storyboard";
      const names = storyboard
        ? (Array.isArray(job.payload?.beats) ? job.payload.beats as Array<{ n?: unknown }> : []).map(b => Number(b?.n)).filter(n => Number.isInteger(n) && n >= 1 && n <= 6).slice(0, 6).map(n => `frame-${n}.png`)
        : ["sheet-1.png"];
      const uploads = await Promise.all(names.map(async name => ({ name, url: await store.presignWorkerUpload(characterSheetKey(job.location_id as string, job.created_by_clerk_user_id as string, job.id as string, name), "image/png", SIGNED_SECONDS) })));
      const characterSheets = storyboard ? await latestSheetLinks(store, job.location_id, job.created_by_clerk_user_id) : [];
      return { ...job, payload: { ...job.payload, photos, uploads, ...(characterSheets.length ? { characterSheets } : {}) } };
    } catch { return raw; }   // the Mac then reports the request as invalid: nothing is half-sent
  }));
}

/** Claim time for a video job: private links to this person's latest finished turnaround and face sheets, so storyboard frames are drawn from them. Losing them only costs consistency: the photo is still used. */
export async function withCharacterSheetReferences(jobs: unknown): Promise<unknown> {
  if (!Array.isArray(jobs) || !jobs.some(j => j?.kind === "studio.video_assemble")) return jobs;
  const config = readStudioR2Config();
  if (!config) return jobs;
  const store = createStudioR2Store(config);
  return Promise.all(jobs.map(async raw => {
    const job = raw as { kind?: unknown; location_id?: unknown; created_by_clerk_user_id?: unknown; payload?: Record<string, unknown> };
    if (job?.kind !== "studio.video_assemble" || typeof job.location_id !== "string" || typeof job.created_by_clerk_user_id !== "string" || !job.payload?.storyboardFrames) return raw;
    try {
      const characterSheets = await latestSheetLinks(store, job.location_id, job.created_by_clerk_user_id);
      return characterSheets.length ? { ...job, payload: { ...job.payload, characterSheets } } : raw;
    } catch { return raw; }
  }));
}
