import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { cleanProfile } from "../character-profile";
import { sheetPrompt, type SheetKind } from "../images/character-sheet";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import type { FrameDrawer } from "./codex-image";
import type { FootageSegment } from "./footage-transcript";

const payload = z.object({
  sheet: z.enum(["turnaround", "expressions", "face", "outfits", "storyboard", "transcript"]),
  /** Transcript only, added at claim time: a private link to the uploaded video. */
  media: z.object({ url: z.string().url().max(4000) }).optional(),
  profile: z.object({ aspects: z.array(z.object({ key: z.string().max(40), value: z.string().max(200), locked: z.boolean() })).max(12), notes: z.string().max(400).optional() }).passthrough().optional(),
  /** Storyboard only: one picture per script beat, each with the scene text to draw. */
  beats: z.array(z.object({ n: z.number().int().min(1).max(40), prompt: z.string().min(1).max(1500) }).passthrough()).min(1).max(40).optional(),
  /** Storyboard only, added at claim time: the creator's latest turnaround and face sheets, when they have them. */
  characterSheets: z.array(z.object({ name: z.string().regex(/^character-(turnaround|face)\.png$/), url: z.string().url().max(4000) })).max(2).optional(),
  /** Added at claim time: short-lived private links to this person's own photos (the face first) and one upload link per picture. */
  photos: z.array(z.object({ name: z.string().regex(/^photo-[1-5]\.(jpg|png|webp)$/), url: z.string().url().max(4000) })).max(3).default([]),
  uploads: z.array(z.object({ name: z.string().regex(/^(?:(?:sheet-[1-4]|frame-(?:[1-9]|[1-3][0-9]|40))\.png|transcript\.json)$/), url: z.string().url().max(4000) })).min(1).max(40),
}).passthrough();

const MAX_PHOTO = 8 * 1024 * 1024, MAX_SHEET = 12 * 1024 * 1024;
async function getBytes(url: string, fetcher: typeof fetch, signal: AbortSignal, max: number): Promise<Buffer> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("refused");
  const r = await fetcher(target, { redirect: "error", signal });
  if (!r.ok) throw new Error("download_failed");
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length || bytes.length > max) throw new Error("bad_size");
  return bytes;
}

export interface CharacterSheetDeps {
  enabled: () => boolean;
  /** The Codex CLI is installed and signed in with ChatGPT on this Mac. */
  ready: () => boolean;
  draw: FrameDrawer;
  /** Offline Parakeet on this Mac: timed lines for a local media file, or null when the tools are not set up. */
  transcribe?: (file: string, signal?: AbortSignal) => Promise<FootageSegment[] | null>;
  workRoot?: string;
  fetcher?: typeof fetch;
}
const SHEETS_INTRO = "Use $imagegen to create one new image. The attached images are reference sheets and photos of the same person: keep exactly their face, hair, build and clothing in the new scene.";
const SCENE_INTRO = "Use $imagegen to create one new image. The first attached image or images are earlier shots of this same video: keep exactly the same room, set, background, lighting, props and camera style, and the same person (the later attached sheets and photos show the face). Change only what this shot asks for: the framing, the pose or what is on screen.";
const INTRO = "Use $imagegen to create one new image. The attached photos show the person: use them as the only source for the face, hairstyle and skin tone.";

/** studio.character_sheet: one reference sheet from the creator's own photos, drawn by Codex on this Mac with their ChatGPT login (included in the subscription), uploaded through a private link, reported by file name only. */
export function createCharacterSheetHandler(deps: CharacterSheetDeps): StudioJobHandler {
  const fetcher = deps.fetcher ?? fetch;
  const put = async (url: string, bytes: Buffer, signal: AbortSignal) => {
    if (new URL(url).protocol !== "https:") return false;
    try { const r = await fetcher(new URL(url), { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes), redirect: "error", signal }); return r.ok; }
    catch (error) { if (signal.aborted) throw error; return false; }
  };
  /** One picture per beat from the creator's photos (and character sheets, when there are some). A beat that fails costs only that picture; none drawn is a failure the creator can retry. */
  const drawStoryboard = async (p: z.infer<typeof payload>, photos: string[], dir: string, signal: AbortSignal) => {
    const sheets: string[] = [];
    for (const sheet of p.characterSheets ?? []) {
      try { const file = join(dir, sheet.name); await writeFile(file, await getBytes(sheet.url, fetcher, signal, MAX_SHEET), { mode: 0o600 }); sheets.push(file); }
      catch (error) { if (signal.aborted) throw error; }
    }
    const files: string[] = [];
    const drawn: string[] = [];   // pictures already drawn for this video, kept as scene references so the set stays the same
    for (const beat of p.beats ?? []) {
      const name = `frame-${beat.n}.png`, target = p.uploads.find(u => u.name === name);
      if (!target) continue;
      const out = join(dir, name);
      // The first picture and the latest one set the scene; at most six images go to the model (scene, then sheets, then photos).
      const scene = drawn.length > 1 ? [drawn[0], drawn[drawn.length - 1]] : drawn.slice(0, 1);
      const rest = [...sheets, ...photos].slice(0, 6 - scene.length);
      const ok = await deps.draw({ prompt: beat.prompt, references: [...scene, ...rest], out, signal, intro: scene.length ? SCENE_INTRO : sheets.length ? SHEETS_INTRO : INTRO }).catch(error => { if (signal.aborted) throw error; return false; });
      if (!ok) continue;
      const bytes = await readFile(out);
      if (bytes.length <= MAX_SHEET && await put(target.url, bytes, signal)) { files.push(name); drawn.push(out); }
    }
    if (!files.length) throw new StudioJobError("storyboard_failed", "The Mac could not draw the storyboard. Try again.", false);
    return { sheet: "storyboard", files };
  };
  /** The uploaded video is read through a private link, transcribed here, and the timed lines go back as one private file. Nothing leaves this Mac for a paid service. */
  const transcribeUpload = async (p: z.infer<typeof payload>, dir: string, signal: AbortSignal) => {
    const target = p.uploads.find(u => u.name === "transcript.json");
    if (!p.media || !target || !deps.transcribe) throw new StudioJobError("invalid_job_payload", "This transcript request is invalid.", false);
    if (new URL(p.media.url).protocol !== "https:" || new URL(target.url).protocol !== "https:") throw new StudioJobError("invalid_job_payload", "This transcript request is invalid.", false);
    const file = join(dir, "media");
    try {
      const r = await fetcher(new URL(p.media.url), { redirect: "error", signal });
      if (!r.ok || !r.body) throw new Error("download_failed");
      await pipeline(Readable.fromWeb(r.body as never), createWriteStream(file, { mode: 0o600 }));
    } catch (error) { if (signal.aborted) throw error; throw new StudioJobError("media_unavailable", "The Mac could not download the video. Try again.", false); }
    const segments = await deps.transcribe(file, signal);
    if (segments === null) throw new StudioJobError("transcription_tools_missing", "Install the transcription tools on this Mac in Setup, then try again.", false);
    if (!segments.length) throw new StudioJobError("no_speech", "No speech was found in this video, so there is nothing to match to the script.", false);
    const body = Buffer.from(JSON.stringify({ segments }), "utf8");
    let put: Response;
    try { put = await fetcher(new URL(target.url), { method: "PUT", headers: { "content-type": "application/json" }, body: new Uint8Array(body), redirect: "error", signal }); }
    catch (error) { if (signal.aborted) throw error; throw new StudioJobError("transcript_upload_failed", "The Mac could not save the transcript. Try again.", false); }
    if (!put.ok) throw new StudioJobError("transcript_upload_failed", "The Mac could not save the transcript. Try again.", false);
    return { sheet: "transcript", files: ["transcript.json"] };
  };
  return async (job, context) => {
    const parsed = payload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This sheet request is invalid.", false);
    if (parsed.data.sheet !== "transcript" && !parsed.data.photos.length) throw new StudioJobError("invalid_job_payload", "This sheet request is invalid.", false);
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Turn on Mac processing in Setup and keep it On.", true, 300);
    if (parsed.data.sheet === "transcript") {
      const dir = await mkdtemp(join(deps.workRoot ?? tmpdir(), "studio-transcript-"));
      try { return await transcribeUpload(parsed.data, dir, context.signal); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
    }
    if (!deps.ready()) throw new StudioJobError("codex_not_ready", "Sign in to Codex with ChatGPT on this Mac, then try again.", true, 300);
    const p = parsed.data, dir = await mkdtemp(join(deps.workRoot ?? tmpdir(), "studio-sheet-"));
    try {
      const references: string[] = [];
      for (const photo of p.photos) {
        try { const file = join(dir, photo.name); await writeFile(file, await getBytes(photo.url, fetcher, context.signal, MAX_PHOTO), { mode: 0o600 }); references.push(file); }
        catch (error) { if (context.signal.aborted) throw error; }
      }
      if (!references.length) throw new StudioJobError("photos_unavailable", "The Mac could not download your photos. Try again.", false);
      if (p.sheet === "storyboard") return await drawStoryboard(p, references, dir, context.signal);
      if (!p.profile) throw new StudioJobError("invalid_job_payload", "This sheet request is invalid.", false);
      const out = join(dir, "sheet-1.png");
      const ok = await deps.draw({ prompt: sheetPrompt(p.sheet as SheetKind, cleanProfile(p.profile)), references, out, signal: context.signal, intro: INTRO });
      if (!ok) throw new StudioJobError("sheet_failed", "The Mac could not draw this sheet. Try again.", false);
      const target = p.uploads.find(u => u.name === "sheet-1.png");
      if (!target) throw new StudioJobError("invalid_job_payload", "This sheet request is invalid.", false);
      const bytes = await readFile(out);
      if (bytes.length > MAX_SHEET) throw new StudioJobError("sheet_failed", "The picture came out too large. Try again.", false);
      let put: Response;
      if (new URL(target.url).protocol !== "https:") throw new StudioJobError("sheet_upload_failed", "The Mac could not save the sheet. Try again.", false);
      try { put = await fetcher(new URL(target.url), { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes), redirect: "error", signal: context.signal }); }
      catch (error) { if (context.signal.aborted) throw error; throw new StudioJobError("sheet_upload_failed", "The Mac could not save the sheet. Try again.", false); }
      if (!put.ok) throw new StudioJobError("sheet_upload_failed", "The Mac could not save the sheet. Try again.", false);
      return { sheet: p.sheet, files: ["sheet-1.png"] };
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  };
}
