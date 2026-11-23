import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { request as httpsRequest } from "node:https";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { deviceCall, type DeviceCallOptions } from "./http-queue";
import type { DeviceCredentials } from "./config";
import type { AssembleOptions, AssembleResult } from "../video-assembly/assemble";
import { freeBytes, nextProjectFile, projectFolderName, type ProjectStore } from "./video-projects";

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

/** TEMPORARY: the deployed server predates the edit-loop migration and rejects these two result fields. Set to true once release 52ee4ff9+ is live. */
const SERVER_HAS_PROJECT_FIELDS = false;
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
      // The presigned URL signs content-type, content-length and if-none-match, so all three must be sent. A plain https PUT piping the file: no fetch/web-stream bridge (it crashed the process), exact content-length, bounded time.
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpsRequest(target, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(byteSize), "if-none-match": "*" }, signal: AbortSignal.any([signal, AbortSignal.timeout(60 * 60_000)]) },
          res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); res.on("error", reject); });
        req.on("error", reject);
        const source = createReadStream(file); source.on("error", reject); source.pipe(req);
      });
      if (status < 200 || status >= 300) throw new Error(`video_upload_http_${status}`);
    },
  };
}

export interface VideoAssembleDeps {
  enabled: () => boolean;
  /** substo + ffprobe present, and the subscription CLI that drives the editor is signed in. */
  tools: (signal: AbortSignal) => Promise<{ ready: boolean; missing: string[] }>;
  /** On-device Qwen3-TTS is installed (only needed for a local voice). */
  localSpeechReady: () => Promise<boolean>;
  /** Scratch space for downloads; removed after every job. The project itself lives in projectsRoot and is kept. */
  workRoot: string; projectsRoot: string; projects: ProjectStore; editorDocs: string; model?: string;
  api: ExportApi;
  /** Offline timed speech for each footage file (Parakeet); omitted or null leaves the agent without a transcript. */
  transcribeFootage?: (file: string, signal?: AbortSignal) => Promise<{ start: number; end: number; text: string }[] | null>;
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


/** The newest finished export in a project folder, optionally only one made after `sinceMs`. */
export async function latestExport(projectDir: string, sinceMs = 0): Promise<{ name: string; file: string; size: number } | null> {
  try {
    const files = (await readdir(join(projectDir, "exports"))).filter(f => f.toLowerCase().endsWith(".mp4"));
    const withTimes = await Promise.all(files.map(async f => ({ f, t: (await stat(join(projectDir, "exports", f))).mtimeMs })));
    const newest = withTimes.filter(x => x.t >= sinceMs).sort((a, b) => b.t - a.t)[0];
    if (!newest) return null;
    const file = join(projectDir, "exports", newest.f);
    return { name: newest.f, file, size: (await stat(file)).size };
  } catch { return null; }
}
/** Reserve, upload and verify one export through the lease-fenced device endpoints. Returns the saved upload's id. */
export async function saveExport(api: ExportApi, lease: ExportLease, exported: { file: string; size: number }, signal: AbortSignal): Promise<string> {
  if (exported.size < 1000 || exported.size > 5_368_709_120) throw new StudioJobError("video_export_size", "The exported video has an unusable size.", false);
  const digest = await sha256(exported.file);
  let step = "reserve";
  try {
    const slot = await api.reserve(lease, digest, exported.size);
    if (slot.state !== "verified") {
      if (!slot.uploadUrl) throw new Error("no_upload_url");
      step = "put"; await api.put(slot.uploadUrl, exported.file, exported.size, signal);
      step = "verify"; await api.verify(lease);
    }
    return slot.uploadId;
  } catch (error) {
    if (signal.aborted) throw error;
    // Only fixed codes or the error class name are reported, never response bodies, URLs or credentials.
    const detail = error instanceof Error ? (/^(device_[a-z0-9_]+_failed|video_[a-z0-9_]+|no_upload_url)$/.test(error.message) ? error.message : error.name) : "unknown";
    throw new StudioJobError("video_upload_failed", "The video was made but could not be saved to Studio. Try again.", false, undefined, `${step}:${detail}`.slice(0, 80));
  }
}

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

    const work = join(deps.workRoot, job.id), clipsDir = join(work, "footage");
    const title = typeof (job.payload as { title?: unknown }).title === "string" ? String((job.payload as { title: string }).title) : "video";
    const projectDir = join(deps.projectsRoot, projectFolderName(title, p.recordId));
    const lease: ExportLease = { jobId: job.id, workerId: context.workerId, leaseToken: job.lease_token };
    const fetcher = deps.fetcher ?? fetch;
    // Keeping the project means keeping its media: refuse early rather than fill the disk (footage twice plus headroom for the export).
    const need = [...p.downloads, ...p.voiceDownloads].reduce((n, d) => n + d.byteSize, 0) * 2 + 2_000_000_000;
    if (await freeBytes(deps.projectsRoot).catch(() => Infinity) < need) throw new StudioJobError("disk_low", "This Mac does not have enough free disk space to keep this project. Free some space, then make the video again.", false);
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
      await mkdir(projectDir, { recursive: true });
      const projectFile = await nextProjectFile(projectDir), startedAt = Date.now();
      let result: AssembleResult;
      try {
        result = await deps.assemble({ transcribeFootage: deps.transcribeFootage, script: p.script, clipsDir, projectDir, projectFile, editorDocs: deps.editorDocs, orientation: p.options.portrait ? "portrait" : "landscape",
          voiceover: p.options.voiceover, music: p.options.music, model: deps.model, signal: context.signal,
          voice: !p.options.voiceover ? undefined : p.voice?.engine === "local" ? { engine: "local", speaker: p.voice.speaker, model: p.voice.model } : p.voice?.engine === "hosted" ? { engine: "prerendered", files: narration } : undefined });
      } catch (error) {
        if (context.signal.aborted) throw error;
        throw new StudioJobError("video_assembly_failed", "The Mac could not finish editing this video. It was not retried.", false);
      }
      const exported = await latestExport(projectDir, startedAt);
      if (!exported) {
        // Keep what the agent said next to the project (local only) and recognise the subscription's own usage limit.
        await writeFile(join(projectDir, "agent-log.txt"), (result.agentOutput ?? "").slice(0, 20_000)).catch(() => {});
        if (/usage limit|rate limit|limit reached|resets? at/i.test(result.agentOutput ?? "")) throw new StudioJobError("agent_rate_limited", "Your Claude subscription hit its usage limit while editing. Try again after it resets.", false);
        throw new StudioJobError("video_not_exported", "The editor finished without exporting a video. Make the video again.", false, undefined, "agent_log_saved");
      }
      // The edit is kept from here on, whether or not the upload below succeeds.
      await deps.projects.set(p.recordId, { dir: projectDir, file: result.projectFile }).catch(() => {});
      const uploadId = await saveExport(deps.api, lease, exported, context.signal);
      const mb = (exported.size / 1_000_000).toFixed(1);
      return { assembly: { exportName: exported.name.slice(0, 200), bytes: exported.size, beats: result.beats, clips: result.clips.length, voiced: result.voiceFiles.length, uploadId, exportSaved: true, ...(SERVER_HAS_PROJECT_FIELDS ? { projectKept: true, projectName: projectFolderName(title, p.recordId) } : {}),
        summary: `${result.beats} beats, ${result.clips.length} clip${result.clips.length === 1 ? "" : "s"}${result.voiceFiles.length ? ", generated voiceover" : ""}, ${mb} MB. Kept on your Mac; ask the agent below to change it or open it in the editor.` } };
    } finally { await rm(work, { recursive: true, force: true }).catch(() => {}); }
  };
}
