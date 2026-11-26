import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StudioJobError } from "../worker/handlers";
import { readAssemblyResult, readDeviceCommand, safeDeviceCapabilities } from "../devices-policy";
import { createVideoAssembleHandler, type ExportApi, type VideoAssembleDeps } from "./video-assemble";
import { discoverAssemblyTools } from "./video-assemble-tools";
import type { AssembleOptions } from "../video-assembly/assemble";
import { readVideoAssemblyOptions, videoAssemblyStatusLine } from "../video-assembly-policy";

const jobId = "11111111-1111-4111-8111-111111111111", upload = "22222222-2222-4222-8222-222222222222", record = "33333333-3333-4333-8333-333333333333";
const job = (extra: Record<string, unknown> = {}, options = { voiceover: true, music: false, portrait: false }) => ({ id: jobId, location_id: "loc", kind: "studio.video_assemble", lease_token: "44444444-4444-4444-8444-444444444444", attempts: 1, max_attempts: 1,
  payload: { recordId: record, script: "Hi.", options, media: [{ uploadId: upload, name: "shot.mov", byteSize: 4 }], downloads: [{ name: "shot.mov", url: "https://r2.example/shot", byteSize: 4 }], voice: { engine: "local", model: "m", speaker: "ryan" }, ...extra } });
const ctx = () => ({ signal: new AbortController().signal, workerId: "mac" });

async function deps(over: Partial<VideoAssembleDeps> = {}) {
  const root = await mkdtemp(join(tmpdir(), "va-"));
  const calls: string[] = [];
  const api: ExportApi = { reserve: async () => { calls.push("reserve"); return { uploadId: upload, state: "reserved", uploadUrl: "https://r2.example/put" }; }, put: async () => { calls.push("put"); }, verify: async () => { calls.push("verify"); } };
  const kept = new Map<string, { dir: string; file: string }>();
  const projects = { get: async (id: string) => kept.has(id) ? { ...kept.get(id)!, updatedAt: "" } : null, set: async (id: string, p: { dir: string; file: string }) => { kept.set(id, p); } };
  const value: VideoAssembleDeps = { enabled: () => true, tools: async () => ({ ready: true, missing: [] }), localSpeechReady: async () => true, workRoot: root, projectsRoot: join(root, "Projects"), projects, editorDocs: "/docs", api,
    fetcher: (async (url: URL | string) => new Response(String(url).includes("r2.example/sb-") ? "x".repeat(9000) : "data")) as typeof fetch,
    assemble: async o => { await mkdir(join(o.projectDir, "exports"), { recursive: true }); await writeFile(join(o.projectDir, "exports", "Video r2.mp4"), Buffer.alloc(2000, 1));
      assert.deepEqual(await readdir(o.clipsDir), ["shot.mov"]); return { projectDir: o.projectDir, projectFile: "Video.substo", beats: 1, clips: ["shot.mov"], voiceFiles: ["voice-01.mp3"], timings: [0], brief: "" }; },
    ...over };
  return { value, calls, root, kept };
}

test("handler downloads footage, assembles, uploads through the lease-fenced export path and returns bounded facts", async () => {
  const { value, calls, root, kept } = await deps();
  const result = await createVideoAssembleHandler(value)(job() as never, ctx());
  assert.deepEqual(calls, ["reserve", "put", "verify"]);
  const a = (result as { assembly: Record<string, unknown> }).assembly;
  assert.equal(a.uploadId, upload); assert.equal(a.bytes, 2000); assert.equal(a.exportSaved, true);
  assert.doesNotMatch(String(a.summary), /\/|Users/);
  assert.deepEqual(readAssemblyResult(result), result);
  assert.deepEqual((await readdir(root)).sort(), ["Projects"], "per-job scratch removed, the project folder kept");
  assert.equal(a.projectKept, true); assert.match(String(a.projectName), /-33333333$/);
  assert.equal(kept.get(record)?.file, "Video.substo"); assert.ok(kept.get(record)?.dir.startsWith(join(root, "Projects") + "/"));
  assert.ok((await readdir(join(kept.get(record)!.dir, "exports"))).includes("Video r2.mp4"), "export kept with the project");
});
test("gates: processing off, missing tools, voice choice and install only when voiceover, bad payload, missing links", async () => {
  const code = async (over: Partial<VideoAssembleDeps>, j = job()) => (await createVideoAssembleHandler((await deps(over)).value)(j as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal((await code({ enabled: () => false })).code, "local_policy");
  const tools = await code({ tools: async () => ({ ready: false, missing: ["substo"] }) }); assert.equal(tools.code, "video_assembly_tools_missing"); assert.equal(tools.retryable, true); assert.match(tools.message, /substo/);
  assert.equal((await code({ localSpeechReady: async () => false })).code, "local_voice_not_installed");
  assert.equal((await code({}, job({ voice: undefined }))).code, "voice_missing");
  assert.equal((await code({}, job({ voice: { engine: "hosted", provider: "fish", name: "Me", uploadIds: [upload] }, voiceDownloads: [] }))).code, "narration_unavailable");
  const noVoice = await createVideoAssembleHandler((await deps({ localSpeechReady: async () => false })).value)(job({}, { voiceover: false, music: false, portrait: false }) as never, ctx());
  assert.ok((noVoice as { assembly: unknown }).assembly);
  assert.equal((await code({}, { ...job(), payload: { recordId: "x" } })).code, "invalid_job_payload");
  assert.equal((await code({}, job({ downloads: [] }))).code, "footage_unavailable");
});
test("no export, or a failed editor, is a definitive failure that is not retried", async () => {
  const none = (await createVideoAssembleHandler((await deps({ assemble: async o => ({ projectDir: o.projectDir, projectFile: "Video.substo", beats: 1, clips: [], voiceFiles: [], timings: [], brief: "" }) })).value)(job() as never, ctx()).catch(e => e)) as StudioJobError;
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
  form.set("voiceId", "44444444-4444-4444-8444-444444444444"); assert.equal(readVideoAssemblyOptions(form).voiceId, "44444444-4444-4444-8444-444444444444");
  form.set("voiceId", "../x"); assert.equal(readVideoAssemblyOptions(form).voiceId, undefined);
  assert.equal(videoAssemblyStatusLine({ jobId, status: "queued", message: null, summary: null, createdAt: "" }, false), "Waiting for your Mac to come online.");
});

test("hosted narration is downloaded and handed to the assembler as pre-rendered files", async () => {
  let seen: AssembleOptions | undefined;
  const d = await deps({ assemble: async o => { seen = o; return { projectDir: o.projectDir, beats: 1, clips: ["shot.mov"], voiceFiles: ["voice-01.mp3"], timings: [0], brief: "" }; } });
  await createVideoAssembleHandler(d.value)(job({ voice: { engine: "hosted", provider: "fish", name: "Me", uploadIds: [upload] }, voiceDownloads: [{ name: "Narration 01.mp3", url: "https://r2.example/n1", byteSize: 4 }] }) as never, ctx()).catch(() => {});
  assert.deepEqual(seen?.voice, { engine: "prerendered", files: ["narration-001.mp3"] });
});

test("server-made music and whoosh are downloaded under fixed names and passed to the assembler; a failed one is skipped, not fatal", async () => {
  let seen: AssembleOptions | undefined;
  const d = await deps({ assemble: async o => { seen = o; return { projectDir: o.projectDir, beats: 1, clips: ["shot.mov"], voiceFiles: [], timings: [], brief: "" }; } });
  await createVideoAssembleHandler(d.value)(job({ soundDownloads: [{ role: "music", name: "Narration sound-music 90s x.mp3", url: "https://r2.example/m", byteSize: 4 }, { role: "sfx", name: "Narration sound-sfx x.mp3", url: "https://r2.example/s", byteSize: 4 }] }) as never, ctx()).catch(() => {});
  assert.deepEqual(seen?.sounds, { music: "music-bed.mp3", sfx: "whoosh.mp3" });
  const none = await deps({ assemble: async o => { seen = o; return { projectDir: o.projectDir, beats: 1, clips: [], voiceFiles: [], timings: [], brief: "" }; } });
  await createVideoAssembleHandler(none.value)(job() as never, ctx()).catch(() => {});
  assert.deepEqual(seen?.sounds, {});   // an older server sends nothing: the brief then promises no sound files
});

test("an on-device cloned voice needs the Base model and its reference, and narrates from the cached reference", async () => {
  const speaker = "clone-55555555-5555-4555-8555-555555555555", ref = { id: "55555555-5555-4555-8555-555555555555", audioUrl: "https://r2.example/a.wav", textUrl: "https://r2.example/t.json" };
  const cloneJob = (extra: Record<string, unknown> = {}) => job({ voice: { engine: "local", model: "m", speaker }, voiceReference: ref, ...extra });
  const code = async (over: Partial<VideoAssembleDeps>, j = cloneJob()) => (await createVideoAssembleHandler((await deps(over)).value)(j as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal((await code({ localCloneReady: async () => false })).code, "local_clone_model_missing");
  assert.equal((await code({ localCloneReady: async () => true }, cloneJob({ voiceReference: undefined }))).code, "voice_reference_missing");
  assert.equal((await code({ localCloneReady: async () => true, reference: async () => { throw new Error("x"); } })).code, "voice_reference_unavailable");
  let used: unknown;
  const { value } = await deps({ localCloneReady: async () => true, reference: async () => ({ audio: "/v/a.wav", text: "the exact words" }),
    assemble: async o => { used = o.voice; await mkdir(join(o.projectDir, "exports"), { recursive: true }); await writeFile(join(o.projectDir, "exports", "Video r2.mp4"), Buffer.alloc(2000, 1));
      return { projectDir: o.projectDir, projectFile: "Video.substo", beats: 1, clips: ["shot.mov"], voiceFiles: ["voice-01.mp3"], timings: [0], brief: "" }; } });
  await createVideoAssembleHandler(value)(cloneJob() as never, ctx());
  assert.deepEqual(used, { engine: "local", speaker, model: "m", reference: { audio: "/v/a.wav", text: "the exact words" } });
});

test("the creator's storyboard photo is downloaded under its fixed name and passed on; without one, or when it fails, nothing is passed", async () => {
  let seen: AssembleOptions | undefined;
  const run = async (extra: Record<string, unknown>) => {
    const d = await deps({ assemble: async o => { seen = o; return { projectDir: o.projectDir, beats: 1, clips: ["shot.mov"], voiceFiles: [], timings: [], brief: "" }; } });
    seen = undefined;
    await createVideoAssembleHandler(d.value)(job(extra) as never, ctx()).catch(() => {});
    return seen as AssembleOptions | undefined;
  };
  assert.equal((await run({ avatar: { name: "storyboard-avatar.png", contentType: "image/png", url: "https://r2.example/a", byteSize: 4 } }))?.avatar, "storyboard-avatar.png");
  assert.equal((await run({}))?.avatar, undefined);   // an older server or no photo
  assert.equal((await run({ avatar: { name: "../../evil.png", contentType: "image/png", url: "https://r2.example/a", byteSize: 4 } }))?.avatar, undefined);   // only the fixed names are accepted
});

test("storyboard frames: Codex draws one per beat when there is no footage, with the creator's photo attached; a failed frame costs only that frame; with or without footage; none without the photo", async () => {
  const avatar = { name: "storyboard-avatar.png", contentType: "image/png", url: "https://r2.example/a", byteSize: 4 };
  const script = "One line.\n\n[Open on the desk]\nTwo lines here.\n\nThree.";
  const run = async (extra: Record<string, unknown>, failBeat = 0) => {
    const drawn: { out: string; references: string[]; prompt: string }[] = [];
    let seen: AssembleOptions | undefined;
    const d = await deps({
      drawFrame: async r => { drawn.push(r); return !r.out.endsWith(`storyboard-frame-${failBeat}.png`); },
      assemble: async o => { seen = o; return { projectDir: o.projectDir, beats: 3, clips: [], voiceFiles: [], timings: [], brief: "" }; },
    });
    await createVideoAssembleHandler(d.value)(job({ script, ...extra }) as never, ctx()).catch(() => {});
    return { drawn, seen: seen as AssembleOptions | undefined };
  };
  const none = { media: [], downloads: [], avatar, storyboardFrames: { source: "codex", max: 6 } };
  const a = await run(none, 2);
  assert.equal(a.drawn.length, 3);
  assert.ok(a.drawn.every(d => d.references.length === 1 && d.references[0].endsWith("storyboard-avatar.png")));
  assert.match(a.drawn[0].prompt, /wide 16:9 landscape image that fills the whole frame/);   // the shape is in the prompt
  assert.match(a.drawn[1].prompt, /Open on the desk/);   // the beat's own visual note is its scene
  assert.deepEqual((a.seen?.frames ?? []).filter(Boolean), ["storyboard-frame-1.png", "storyboard-frame-3.png"]);   // beat 2 failed: it keeps the plain photo
  assert.equal((await run({ ...none, storyboardFrames: { source: "codex", max: 2 } })).drawn.length, 2);   // the cap
  // Character sheets are references too: tried first, with the sheet wording; too-small downloads are ignored and the photo alone is used.
  const sheets = await run({ ...none, characterSheets: [{ name: "character-turnaround.png", url: "https://r2.example/t" }] });
  assert.equal(sheets.drawn[0].references.length, 1);   // "data" is under 8 KB, so the sheet is ignored: photo only
  assert.equal((await run({ ...none, characterSheets: [{ name: "../evil.png", url: "https://r2.example/e" }] })).drawn.length, 0);   // only the fixed names are accepted
  assert.equal((await run({ avatar, storyboardFrames: { source: "codex", max: 6 } })).drawn.length, 3);      // footage present: frames still drawn for beats it does not cover
  // Pictures the creator approved in the Storyboard step are used as they are, and nothing else is drawn.
  const approved = await run({ ...none, storyboardPreviews: [{ beat: 1, name: "storyboard-frame-1.png", url: "https://r2.example/sb-1" }, { beat: 3, name: "storyboard-frame-3.png", url: "https://r2.example/sb-3" }] });
  assert.equal(approved.drawn.length, 0);
  assert.deepEqual((approved.seen?.frames ?? []).filter(Boolean), ["storyboard-frame-1.png", "storyboard-frame-3.png"]);
  assert.equal((await run({ ...none, storyboardPreviews: [{ beat: 1, name: "../x.png", url: "https://r2.example/s1" }] })).seen, undefined);   // only the fixed names are accepted
  assert.equal((await run({ media: [], downloads: [], storyboardFrames: { source: "codex", max: 6 } })).drawn.length, 0);   // no photo
  assert.equal((await run({ media: [], downloads: [], avatar })).drawn.length, 0);                              // not chosen
});
