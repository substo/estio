import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StudioJobError } from "../worker/handlers";
import { readAssemblyResult, readDeviceCommand, safeDeviceCapabilities } from "../devices-policy";
import { createVideoAssembleHandler, type ExportApi, type VideoAssembleDeps } from "./video-assemble";
import { discoverAssemblyTools } from "./video-assemble-tools";
import { readVideoAssemblyOptions, videoAssemblyStatusLine } from "../video-assembly-policy";

const jobId = "11111111-1111-4111-8111-111111111111", upload = "22222222-2222-4222-8222-222222222222", record = "33333333-3333-4333-8333-333333333333";
const job = (extra: Record<string, unknown> = {}, options = { voiceover: true, music: false, portrait: false }) => ({ id: jobId, location_id: "loc", kind: "studio.video_assemble", lease_token: "44444444-4444-4444-8444-444444444444", attempts: 1, max_attempts: 1,
  payload: { recordId: record, script: "Hi.", options, media: [{ uploadId: upload, name: "shot.mov", byteSize: 4 }], downloads: [{ name: "shot.mov", url: "https://r2.example/shot", byteSize: 4 }], ...extra } });
const ctx = () => ({ signal: new AbortController().signal, workerId: "mac" });

async function deps(over: Partial<VideoAssembleDeps> = {}) {
  const root = await mkdtemp(join(tmpdir(), "va-"));
  const calls: string[] = [];
  const api: ExportApi = { reserve: async () => { calls.push("reserve"); return { uploadId: upload, state: "reserved", uploadUrl: "https://r2.example/put" }; }, put: async () => { calls.push("put"); }, verify: async () => { calls.push("verify"); } };
  const value: VideoAssembleDeps = { enabled: () => true, tools: async () => ({ ready: true, missing: [] }), elevenLabsKey: async () => "key", workRoot: root, editorDocs: "/docs", api,
    fetcher: (async () => new Response("data")) as typeof fetch,
    assemble: async o => { await mkdir(join(o.projectDir, "exports"), { recursive: true }); await writeFile(join(o.projectDir, "exports", "Video r2.mp4"), Buffer.alloc(2000, 1));
      assert.deepEqual(await readdir(o.clipsDir), ["shot.mov"]); return { projectDir: o.projectDir, beats: 1, clips: ["shot.mov"], voiceFiles: ["voice-01.mp3"], timings: [0], brief: "" }; },
    ...over };
  return { value, calls, root };
}

test("handler downloads footage, assembles, uploads through the lease-fenced export path and returns bounded facts", async () => {
  const { value, calls, root } = await deps();
  const result = await createVideoAssembleHandler(value)(job() as never, ctx());
  assert.deepEqual(calls, ["reserve", "put", "verify"]);
  const a = (result as { assembly: Record<string, unknown> }).assembly;
  assert.equal(a.uploadId, upload); assert.equal(a.bytes, 2000); assert.equal(a.exportSaved, true);
  assert.doesNotMatch(String(a.summary), /\/|Users/);
  assert.deepEqual(readAssemblyResult(result), result);
  assert.deepEqual(await readdir(root), [], "per-job folder removed");
});
test("gates: processing off, missing tools, missing ElevenLabs key only when voiceover, bad payload, missing links", async () => {
  const code = async (over: Partial<VideoAssembleDeps>, j = job()) => (await createVideoAssembleHandler((await deps(over)).value)(j as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal((await code({ enabled: () => false })).code, "local_policy");
  const tools = await code({ tools: async () => ({ ready: false, missing: ["substo"] }) }); assert.equal(tools.code, "video_assembly_tools_missing"); assert.equal(tools.retryable, true); assert.match(tools.message, /substo/);
  assert.equal((await code({ elevenLabsKey: async () => null })).code, "elevenlabs_key_missing");
  const noVoice = await createVideoAssembleHandler((await deps({ elevenLabsKey: async () => null })).value)(job({}, { voiceover: false, music: false, portrait: false }) as never, ctx());
  assert.ok((noVoice as { assembly: unknown }).assembly);
  assert.equal((await code({}, { ...job(), payload: { recordId: "x" } })).code, "invalid_job_payload");
  assert.equal((await code({}, job({ downloads: [] }))).code, "footage_unavailable");
});
test("no export, or a failed editor, is a definitive failure that is not retried", async () => {
  const none = (await createVideoAssembleHandler((await deps({ assemble: async o => ({ projectDir: o.projectDir, beats: 1, clips: [], voiceFiles: [], timings: [], brief: "" }) })).value)(job() as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal(none.code, "video_not_exported"); assert.equal(none.retryable, false);
  const boom = (await createVideoAssembleHandler((await deps({ assemble: async () => { throw new Error("secret /Users/x path"); } })).value)(job() as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal(boom.code, "video_assembly_failed"); assert.doesNotMatch(boom.message, /secret|Users/);
});
test("a failed upload is reported without replay", async () => {
  const { value } = await deps(); value.api = { ...value.api, put: async () => { throw new Error("nope"); } };
  const e = (await createVideoAssembleHandler(value)(job() as never, ctx()).catch(x => x)) as StudioJobError;
  assert.equal(e.code, "video_upload_failed"); assert.equal(e.retryable, false);
});
test("server boundary accepts the claim flag, export operations and bounded results, and refuses extras", () => {
  const base = { workerId: "mac", jobId, leaseToken: "44444444-4444-4444-8444-444444444444" };
  assert.equal(readDeviceCommand("claim", { workerId: "mac", limit: 1, leaseSeconds: 120, assembleReady: true }).assembleReady, true);
  assert.deepEqual(readDeviceCommand("video_export_reserve", { ...base, sha256: "a".repeat(64), byteSize: 5000 }).byteSize, 5000);
  assert.throws(() => readDeviceCommand("video_export_reserve", { ...base, sha256: "z", byteSize: 5000 }));
  assert.throws(() => readDeviceCommand("video_export_reserve", { ...base, sha256: "a".repeat(64), byteSize: 10 }));
  assert.ok(readDeviceCommand("complete", { ...base, result: { assembly: { bytes: 5, summary: "ok" } } }));
  assert.throws(() => readAssemblyResult({ assembly: { path: "/Users/x" } }));
  assert.throws(() => readAssemblyResult({ assembly: {}, extra: 1 }));
  assert.deepEqual((safeDeviceCapabilities({ videoAssembly: { ready: true, missing: ["substo", "../x"], leak: "/Users" } }) as { videoAssembly: unknown }).videoAssembly, { ready: true, missing: ["substo"] });
});
test("readiness reports names only and the request form maps checkboxes", async () => {
  const run = async (r: { command: string }) => { if (r.command === "ffprobe") throw new Error("missing"); return { stdout: "x", stderr: "" }; };
  assert.deepEqual(await discoverAssemblyTools(false, run as never), { ready: false, missing: ["ffprobe", "Claude sign-in"] });
  assert.equal((await discoverAssemblyTools(true, (async () => ({ stdout: "", stderr: "" })) as never)).ready, true);
  const form = new FormData(); form.set("voiceover", "on"); form.set("evil", "1");
  assert.deepEqual(readVideoAssemblyOptions(form), { voiceover: true, music: false, portrait: false });
  assert.equal(videoAssemblyStatusLine({ jobId, status: "queued", message: null, summary: null, createdAt: "" }, false), "Waiting for your Mac to come online.");
});
