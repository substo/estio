import "server-only";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { characterSheetKey, SHEET_FILE } from "./character-profile";
import { StudioCommandError } from "./command-error";
import { getStudioContentRecord } from "./content";
import { StudioDbError } from "./db";
import { renderShot } from "./images/prompts";
import { shotForBeat } from "./images/storyboard";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { studioDb } from "./studio-db";
import { parseScript, type Beat } from "./video-assembly/script";

/** How many beats get a picture: the first six, so the cost and the time of one drawing stay small and predictable. */
export const STORYBOARD_MAX = 6;
const messages: Record<string, string> = {
  SB001: "The storyboard could not be built from this script. Save the script and try again.", SB002: "This piece could not be found.",
  CS011: "Pair a Mac in Setup to draw the storyboard. Nothing was sent to a paid service.", CS012: "Turn Mac processing on in Setup to draw the storyboard.",
  CS013: "Your Mac is not ready: it needs Codex signed in with ChatGPT. Check Setup, then try again.", CS014: "Update the Studio companion on your Mac (it cannot draw the storyboard yet).",
};
const uuid = /^[0-9a-f-]{36}$/i;
const identity = (a: { locationId: string; app: string; userId: string }) => ({ p_location_id: a.locationId, p_actor_app: a.app, p_clerk_user_id: a.userId });

/** A fingerprint of what one beat says and shows: a picture is only trusted for a beat whose fingerprint still matches. */
export const beatHash = (beat: Pick<Beat, "narration" | "direction">) => createHash("sha256").update(`${beat.narration}\n${beat.direction ?? ""}`).digest("hex");

/** Ask the signed-in user's own Mac to draw one picture per beat of the saved script. */
export async function requestStoryboard(locationId: string, recordId: string, portrait: boolean): Promise<{ jobId: string; reused: boolean }> {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("The storyboard can only be drawn from your own account.", 403);
  const record = await getStudioContentRecord(locationId, recordId);
  if (!record) throw new StudioCommandError("This piece could not be found.", 404);
  const script = typeof record.record.payload.script === "string" ? record.record.payload.script : "";
  const beats = parseScript(script).slice(0, STORYBOARD_MAX);
  if (!beats.length) throw new StudioCommandError("Save a script first, then draw the storyboard.");
  const wide = portrait ? "vertical 9:16 portrait" : "wide 16:9 landscape";
  const payload = beats.map(b => ({ n: b.index, h: beatHash(b),
    prompt: `${renderShot(shotForBeat(b, portrait), "edit", { acceptsText: false }).prompt} Compose it as a ${wide} image that fills the whole frame.`.slice(0, 1500) }));
  try {
    const r = await studioDb.call<{ jobId: string; reused: boolean }>("studio_request_storyboard", { ...identity(access), p_record_id: recordId, p_beats: payload, p_portrait: portrait });
    return { jobId: r.jobId, reused: Boolean(r.reused) };
  } catch (error) {
    const text = error instanceof StudioDbError && error.code ? messages[error.code] : undefined;
    if (text) throw new StudioCommandError(text);
    throw error;
  }
}

export interface StoryboardView {
  status: "none" | "queued" | "running" | "failed" | "cancelled" | "ready"; error: string | null;
  /** One entry per beat of the saved script (the first six), with a picture when one was drawn for what the beat says now. */
  beats: Array<{ n: number; narration: string; direction: string | null; url: string | null; stale: boolean }>;
  drawnAt: string | null; truncated: boolean;
}

type Raw = { latest: { jobId: string; status: string; error: string | null; finishedAt: string | null } | null; ready: { jobId: string; files: unknown; beats: unknown; finishedAt: string | null } | null };
const framesOf = (ready: Raw["ready"]) => {
  const out = new Map<number, { name: string; h: string }>();
  const hashes = new Map<number, string>(Array.isArray(ready?.beats) ? (ready.beats as Array<{ n?: unknown; h?: unknown }>).filter(b => Number.isInteger(b?.n) && typeof b?.h === "string").map(b => [b.n as number, b.h as string]) : []);
  for (const f of Array.isArray(ready?.files) ? ready.files : []) {
    const m = typeof f === "string" && SHEET_FILE.test(f) ? /^frame-([1-6])\.png$/.exec(f) : null;
    if (m && hashes.has(Number(m[1]))) out.set(Number(m[1]), { name: m[0], h: hashes.get(Number(m[1])) as string });
  }
  return out;
};

/** What the Storyboard page shows: the beats, the latest pictures (private reads) and whether each is still current. */
export async function getStoryboard(locationId: string, recordId: string, script: string): Promise<StoryboardView | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const all = parseScript(script), beats = all.slice(0, STORYBOARD_MAX);
  const raw = await studioDb.call<Raw>("studio_storyboard_state", { ...identity(access), p_record_id: recordId }).catch(() => null);
  const frames = framesOf(raw?.ready ?? null);
  const config = readStudioR2Config(), store = config && raw?.ready && uuid.test(raw.ready.jobId) ? createStudioR2Store(config) : null;
  const rows = await Promise.all(beats.map(async b => {
    const f = frames.get(b.index);
    const url = f && store && raw?.ready ? await store.presignRead({ key: characterSheetKey(access.locationId, access.userId, raw.ready.jobId, f.name), contentType: "image/png", contentDisposition: "inline" }).catch(() => null) : null;
    return { n: b.index, narration: b.narration, direction: b.direction ?? null, url, stale: Boolean(url && f && f.h !== beatHash(b)) };
  }));
  const latest = raw?.latest ?? null;
  const active = latest?.status === "queued" || latest?.status === "running";
  const status: StoryboardView["status"] = active ? latest.status as "queued" | "running" : rows.some(r => r.url) ? "ready" : latest?.status === "failed" || latest?.status === "cancelled" ? latest.status : "none";
  return { status, error: latest && (latest.status === "failed" || latest.status === "cancelled") ? latest.error : null, beats: rows, drawnAt: raw?.ready?.finishedAt ?? null, truncated: all.length > beats.length };
}

const SIGNED_SECONDS = 3600;
/** Claim time for a video job: private links to the pictures the creator already drew for this piece, only for beats whose words and visual note have not changed since. Losing them only costs the pictures: the Mac draws or uses the photo as before. */
export async function withStoryboardPreviews(jobs: unknown): Promise<unknown> {
  if (!Array.isArray(jobs) || !jobs.some(j => j?.kind === "studio.video_assemble")) return jobs;
  const config = readStudioR2Config();
  if (!config) return jobs;
  const store = createStudioR2Store(config);
  return Promise.all(jobs.map(async raw => {
    const job = raw as { kind?: unknown; location_id?: unknown; created_by_clerk_user_id?: unknown; payload?: Record<string, unknown> };
    const recordId = job?.payload?.recordId, script = job?.payload?.script;
    if (job?.kind !== "studio.video_assemble" || typeof job.location_id !== "string" || typeof job.created_by_clerk_user_id !== "string" || typeof recordId !== "string" || !uuid.test(recordId) || typeof script !== "string") return raw;
    try {
      const state = await studioDb.call<Raw>("studio_storyboard_for", { p_location_id: job.location_id, p_clerk_user_id: job.created_by_clerk_user_id, p_record_id: recordId });
      if (!state?.ready || !uuid.test(state.ready.jobId)) return raw;
      const frames = framesOf(state.ready);
      const previews = (await Promise.all(parseScript(script).slice(0, STORYBOARD_MAX).map(async b => {
        const f = frames.get(b.index);
        if (!f || f.h !== beatHash(b)) return null;
        return { beat: b.index, name: `storyboard-frame-${b.index}.png`, url: await store.presignWorkerRead(characterSheetKey(job.location_id as string, job.created_by_clerk_user_id as string, state.ready!.jobId, f.name), SIGNED_SECONDS) };
      }))).filter((p): p is { beat: number; name: string; url: string } => p !== null);
      return previews.length ? { ...job, payload: { ...job.payload, storyboardPreviews: previews } } : raw;
    } catch { return raw; }
  }));
}
