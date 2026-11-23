import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { deviceCall, type DeviceCallOptions } from "./http-queue";
import type { DeviceCredentials } from "./config";
import type { AssembleOptions, AssembleResult } from "../video-assembly/assemble";

const payload = z.object({
  recordId: z.string().uuid(), script: z.string().min(1).max(20000),
  options: z.object({ voiceover: z.boolean(), music: z.boolean(), portrait: z.boolean() }).strict(),
  media: z.array(z.object({ uploadId: z.string().uuid(), name: z.string().max(255), byteSize: z.number().int().positive() }).passthrough()).max(40),
  downloads: z.array(z.object({ name: z.string().max(255), url: z.string().url().max(4000), byteSize: z.number().int().positive() })).max(40).default([]),
  /** The chosen voice. Hosted narration is already rendered by the server (the Mac never sees a provider key); local is generated here. */
  voice: z.discriminatedUnion("engine", [
    z.object({ engine: z.literal("local"), model: z.string().max(100), speaker: z.string().regex(/^[a-z_]{2,20}$/) }).strict(),
    z.object({ engine: z.literal("hosted"), provider: z.enum(["fish", "elevenlabs"]), name: z.string().max(80), uploadIds: z.array(z.string().uuid()).min(1).max(200) }).strict(),
  ]).optional(),
  voiceDownloads: z.array(z.object({ name: z.string().max(255), url: z.string().url().max(4000), byteSize: z.number().int().positive() })).max(200).default([]),
}).passthrough();

export interface ExportLease { jobId: string; workerId: string; leaseToken: string }
export interface ExportApi {
  reserve(lease: ExportLease, sha256: string, byteSize: number): Promise<{ uploadId: string; state: string; uploadUrl?: string }>;
  put(url: string, file: string, byteSize: number, signal: AbortSignal): Promise<void>;
  verify(lease: ExportLease): Promise<void>;
}
const reserved = z.object({ uploadId: z.string().uuid(), state: z.string().max(20), uploadUrl: z.string().url().max(4000).optional(), expiresInSeconds: z.number().optional() });
/** The device endpoints that carry the finished export. Both are fenced by the job lease; the server reads the bytes back before saving. */
export function createExportApi(credentials: DeviceCredentials, options: DeviceCallOptions = {}): ExportApi {
  const call = <T>(operation: string, lease: ExportLease, body: Record<string, unknown>, schema: z.ZodType<T>) =>
    deviceCall(credentials.origin, credentials.token, operation, { workerId: lease.workerId, jobId: lease.jobId, leaseToken: lease.leaseToken, ...body }, schema, { ...options, timeoutMs: options.timeoutMs ?? 120_000 });
  return {
    reserve: (lease, sha256, byteSize) => call("video_export_reserve", lease, { sha256, byteSize }, reserved),
    verify: async lease => { await call("video_export_verify", lease, {}, z.object({ uploadId: z.string(), state: z.literal("verified") }).passthrough()); },
    async put(url, file, byteSize, signal) {
      const target = new URL(url);
      if (target.protocol !== "https:") throw new Error("video_upload_refused");
      const response = await (options.fetcher ?? fetch)(target, { method: "PUT", redirect: "error", headers: { "content-type": "video/mp4", "content-length": String(byteSize) },
        body: Readable.toWeb(createReadStream(file)) as unknown as BodyInit, duplex: "half", signal: AbortSignal.any([signal, AbortSignal.timeout(60 * 60_000)]) } as RequestInit);
      if (!response.ok) throw new Error("video_upload_failed");
    },
  };
}

export interface VideoAssembleDeps {
  enabled: () => boolean;
  /** substo + ffprobe present, and the subscription CLI that drives the editor is signed in. */
  tools: (signal: AbortSignal) => Promise<{ ready: boolean; missing: string[] }>;
  /** On-device Qwen3-TTS is installed (only needed for a local voice). */
  localSpeechReady: () => Promise<boolean>;
  workRoot: string; editorDocs: string; model?: string;
  api: ExportApi;
  assemble: (options: AssembleOptions) => Promise<AssembleResult>;
  fetcher?: typeof fetch;
}
const safeName = (name: string, index: number) => (basename(name).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "") || `clip-${index}.mp4`).slice(0, 120);

async function download(url: string, file: string, expected: number, signal: AbortSignal, fetcher: typeof fetch) {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("download_refused");
  const response = await fetcher(target, { redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error("download_failed");
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file), { signal });
  if ((await stat(file)).size !== expected) throw new Error("download_incomplete");
}
async function sha256(file: string) { const hash = createHash("sha256"); await pipeline(createReadStream(file), hash); return hash.digest("hex"); }

/** Mac-only script-to-video. Subscription editing agent, narration only when asked (server-rendered hosted voice or on-device), no hosted or paid fallback, no replay after the agent started. */
export function createVideoAssembleHandler(deps: VideoAssembleDeps): StudioJobHandler {
  return async (job, context) => {
    const parsed = payload.safeParse(job.payload);
    if (!parsed.success) throw new StudioJobError("invalid_job_payload", "This video request is invalid.", false);
    const p = parsed.data;
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Turn on Mac processing in Setup and keep it On.", true, 300);
    const tools = await deps.tools(context.signal);
    if (!tools.ready) throw new StudioJobError("video_assembly_tools_missing", `This Mac is missing ${tools.missing.join(", ")}. Install it, then make the video again.`, true, 600);
    if (p.options.voiceover && !p.voice) throw new StudioJobError("voice_missing", "Choose a voice in Voices, then make the video again.", false);
    if (p.options.voiceover && p.voice?.engine === "local" && !await deps.localSpeechReady()) throw new StudioJobError("local_voice_not_installed", "The on-device voice is not installed on this Mac. Install it in Settings, or choose a hosted voice.", false);
    if (p.options.voiceover && p.voice?.engine === "hosted" && p.voiceDownloads.length !== p.voice.uploadIds.length) throw new StudioJobError("narration_unavailable", "Studio could not provide the narration. Make the video again.", false);
    if (!p.downloads.length && p.media.length) throw new StudioJobError("footage_unavailable", "Studio could not provide the footage links. Make the video again.", false);

    const work = join(deps.workRoot, job.id), clipsDir = join(work, "footage"), projectDir = join(work, "project");
    const lease: ExportLease = { jobId: job.id, workerId: context.workerId, leaseToken: job.lease_token };
    const fetcher = deps.fetcher ?? fetch;
    try {
      await mkdir(clipsDir, { recursive: true });
      const used = new Set<string>();
      for (const [i, item] of p.downloads.entries()) {
        let name = safeName(item.name, i); if (used.has(name)) name = `${i}-${name}`; used.add(name);
        try { await download(item.url, join(clipsDir, name), item.byteSize, context.signal, fetcher); }
        catch (error) { if (context.signal.aborted) throw error; throw new StudioJobError("footage_download_failed", "The Mac could not download the footage. Make the video again.", false); }
      }
      const narration: string[] = [];
      for (const [i, item] of p.voiceDownloads.entries()) {
        const name = `narration-${String(i + 1).padStart(3, "0")}.mp3`; narration.push(name);
        try { await download(item.url, join(clipsDir, name), item.byteSize, context.signal, fetcher); }
        catch (error) { if (context.signal.aborted) throw error; throw new StudioJobError("narration_download_failed", "The Mac could not download the narration. Make the video again.", false); }
      }
      let result: AssembleResult;
      try {
        result = await deps.assemble({ script: p.script, clipsDir, projectDir, editorDocs: deps.editorDocs, orientation: p.options.portrait ? "portrait" : "landscape",
          voiceover: p.options.voiceover, music: p.options.music, model: deps.model, signal: context.signal,
          voice: !p.options.voiceover ? undefined : p.voice?.engine === "local" ? { engine: "local", speaker: p.voice.speaker, model: p.voice.model } : p.voice?.engine === "hosted" ? { engine: "prerendered", files: narration } : undefined });
      } catch (error) {
        if (context.signal.aborted) throw error;
        throw new StudioJobError("video_assembly_failed", "The Mac could not finish editing this video. It was not retried.", false);
      }
      let exported: string | undefined;
      try {
        const files = (await readdir(join(projectDir, "exports"))).filter(f => f.toLowerCase().endsWith(".mp4"));
        const withTimes = await Promise.all(files.map(async f => ({ f, t: (await stat(join(projectDir, "exports", f))).mtimeMs })));
        exported = withTimes.sort((a, b) => b.t - a.t)[0]?.f;
      } catch { /* no exports folder */ }
      if (!exported) throw new StudioJobError("video_not_exported", "The editor finished without exporting a video. Make the video again.", false);
      const file = join(projectDir, "exports", exported), size = (await stat(file)).size;
      if (size < 1000 || size > 5_368_709_120) throw new StudioJobError("video_export_size", "The exported video has an unusable size.", false);
      const digest = await sha256(file);
      try {
        const slot = await deps.api.reserve(lease, digest, size);
        if (slot.state !== "verified") {
          if (!slot.uploadUrl) throw new Error("no_upload_url");
          await deps.api.put(slot.uploadUrl, file, size, context.signal);
          await deps.api.verify(lease);
        }
        const mb = (size / 1_000_000).toFixed(1);
        return { assembly: { exportName: exported.slice(0, 200), bytes: size, beats: result.beats, clips: result.clips.length, voiced: result.voiceFiles.length, uploadId: slot.uploadId, exportSaved: true,
          summary: `${result.beats} beats, ${result.clips.length} clip${result.clips.length === 1 ? "" : "s"}${result.voiceFiles.length ? ", generated voiceover" : ""}, ${mb} MB. Saved in this piece's uploads.` } };
      } catch (error) {
        if (context.signal.aborted) throw error;
        throw new StudioJobError("video_upload_failed", "The video was made but could not be saved to Studio. Make it again.", false);
      }
    } finally { await rm(work, { recursive: true, force: true }).catch(() => {}); }
  };
}
