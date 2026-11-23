import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { LOCAL_SPEAKERS } from "../voices/policy";
import { runNativeProcess, type ProcessRunner } from "./process";

export const PREVIEW_TEXT = "Hello, this is how I will sound in your videos.";
/** The device request body is bounded at 32 KiB, so the sample is a short mono clip: about 4 s at 32 kbps is 16 KB (21 KB as base64). */
export const MAX_PREVIEW_BASE64 = 24000;
const payload = z.object({ voiceId: z.string().uuid(), speaker: z.enum(LOCAL_SPEAKERS), name: z.string().max(80).optional() }).passthrough();

/** Shrink the synthesized MP3 to a short mono clip that fits a device result. */
export async function compressPreview(mp3: Buffer, run: ProcessRunner = runNativeProcess, ffmpeg = process.env.STUDIO_FFMPEG || "/opt/homebrew/bin/ffmpeg"): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "studio-preview-"));
  try {
    await writeFile(join(dir, "in.mp3"), mp3, { mode: 0o600 });
    await run({ command: ffmpeg, args: ["-y", "-loglevel", "error", "-i", "in.mp3", "-t", "4", "-ac", "1", "-ar", "22050", "-b:a", "32k", "out.mp3"], cwd: dir, timeoutMs: 60_000, maxOutputBytes: 8192, env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin` } });
    return await readFile(join(dir, "out.mp3"));
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export interface VoicePreviewDeps {
  enabled: () => boolean;
  /** The on-device voice model and runtime are installed. */
  ready: () => Promise<boolean>;
  synth: (speaker: string, text: string, signal: AbortSignal) => Promise<Buffer>;
  compress?: (mp3: Buffer) => Promise<Buffer>;
}
/** studio.voice_preview: one short sample of a built-in speaker, generated on this Mac and returned inside the job result so the Voices page can play it. No paid provider is involved. */
export function createVoicePreviewHandler(deps: VoicePreviewDeps): StudioJobHandler {
  return async (job, context) => {
    const parsed = payload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This preview request is invalid.", false);
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Turn on Mac processing in Setup and keep it On.", true, 300);
    if (!await deps.ready()) throw new StudioJobError("voice_model_missing", "Install the on-device voice model under Devices, then preview again.", false);
    let audio: Buffer;
    try { audio = await (deps.compress ?? (b => compressPreview(b)))(await deps.synth(parsed.data.speaker, PREVIEW_TEXT, context.signal)); }
    catch (error) {
      if (context.signal.aborted) throw error;
      throw new StudioJobError("voice_preview_failed", "The Mac could not generate the preview. Try again.", false);
    }
    const audioBase64 = audio.toString("base64");
    if (audio.length < 300 || audioBase64.length > MAX_PREVIEW_BASE64) throw new StudioJobError("voice_preview_failed", "The Mac could not generate a usable preview. Try again.", false);
    return { preview: { audioBase64, bytes: audio.length, seconds: Math.min(4, Math.round(audio.length * 8 / 32000 * 10) / 10), speaker: parsed.data.speaker } };
  };
}
