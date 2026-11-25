import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { cleanProfile } from "../character-profile";
import { sheetPrompt, type SheetKind } from "../images/character-sheet";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import type { FrameDrawer } from "./codex-image";

const payload = z.object({
  sheet: z.enum(["turnaround", "expressions", "face", "outfits"]),
  profile: z.object({ aspects: z.array(z.object({ key: z.string().max(40), value: z.string().max(200), locked: z.boolean() })).max(12), notes: z.string().max(400).optional() }).passthrough(),
  /** Added at claim time: short-lived private links to this person's own photos (the face first) and one upload link per picture. */
  photos: z.array(z.object({ name: z.string().regex(/^photo-[1-5]\.(jpg|png|webp)$/), url: z.string().url().max(4000) })).min(1).max(3),
  uploads: z.array(z.object({ name: z.string().regex(/^sheet-[1-4]\.png$/), url: z.string().url().max(4000) })).min(1).max(4),
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
  workRoot?: string;
  fetcher?: typeof fetch;
}
const INTRO = "Use $imagegen to create one new image. The attached photos show the person: use them as the only source for the face, hairstyle and skin tone.";

/** studio.character_sheet: one reference sheet from the creator's own photos, drawn by Codex on this Mac with their ChatGPT login (included in the subscription), uploaded through a private link, reported by file name only. */
export function createCharacterSheetHandler(deps: CharacterSheetDeps): StudioJobHandler {
  const fetcher = deps.fetcher ?? fetch;
  return async (job, context) => {
    const parsed = payload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This sheet request is invalid.", false);
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Turn on Mac processing in Setup and keep it On.", true, 300);
    if (!deps.ready()) throw new StudioJobError("codex_not_ready", "Sign in to Codex with ChatGPT on this Mac, then try again.", true, 300);
    const p = parsed.data, dir = await mkdtemp(join(deps.workRoot ?? tmpdir(), "studio-sheet-"));
    try {
      const references: string[] = [];
      for (const photo of p.photos) {
        try { const file = join(dir, photo.name); await writeFile(file, await getBytes(photo.url, fetcher, context.signal, MAX_PHOTO), { mode: 0o600 }); references.push(file); }
        catch (error) { if (context.signal.aborted) throw error; }
      }
      if (!references.length) throw new StudioJobError("photos_unavailable", "The Mac could not download your photos. Try again.", false);
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
