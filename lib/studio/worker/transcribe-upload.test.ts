import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractAudioChunks, probeMedia } from "./ffmpeg";
import { StudioJobError, StudioProviderRejectedError } from "./handlers";
import { transcribeChunk } from "./openai-transcribe";
import { CHUNK_SECONDS, createTranscribeUploadHandler, type TranscribeDeps } from "./transcribe-upload";

const ws = "70000000-0000-4000-8000-000000000001";
const uploadId = "a3000000-0000-4000-8000-000000000001";
const job = { id: "j", lease_token: "claim-1", workspace_id: ws, kind: "studio.transcribe_upload", payload: { uploadId }, attempts: 1, max_attempts: 5 };
const context = { signal: new AbortController().signal, workerId: "w" };

function fakeDeps(options: { duration?: number; reserve?: string | null; credential?: boolean; done?: number[]; failAt?: number; uncertain?: number[]; transcript?: boolean } = {}) {
  const rpcs: Array<[string, Record<string, any>]> = [];
  const chunks = new Map<number, number>((options.done ?? []).map(i => [i, CHUNK_SECONDS]));
  const transcribed: string[] = [];
  const attempts = new Map<number, string>((options.uncertain ?? []).map(i => [i, "uncertain"]));
  const deps: TranscribeDeps = {
    async rest<T>(p: string, init?: RequestInit) {
      if (p.startsWith("rpc/")) {
        const body = JSON.parse(String(init?.body)); rpcs.push([p.slice(4), body]);
        if (p === "rpc/studio_begin_transcription_attempt") {
          if (chunks.has(body.p_chunk_index)) return { outcome: "saved" } as T;
          if (attempts.has(body.p_chunk_index)) return { outcome: "uncertain" } as T;
          if (options.reserve === null) return { outcome: "budget_exhausted" } as T;
          attempts.set(body.p_chunk_index, "started");
          return { outcome: "started", attempt_id: String(body.p_chunk_index) } as T;
        }
        if (p === "rpc/studio_finish_transcription_attempt") {
          const i = Number(body.p_attempt_id);
          chunks.set(i, Math.min(600, (options.duration ?? 1500) - i * 600));
          attempts.set(i, "succeeded");
        }
        if (p === "rpc/studio_close_transcription_attempt") {
          const i = Number(body.p_attempt_id);
          if (attempts.get(i) === "started") {
            if (body.p_rejected) attempts.delete(i); else attempts.set(i, "uncertain");
          }
        }
        return true as T;
      }
      if (p.startsWith("studio_uploads")) return [{ object_key: `${ws}/uploads/${uploadId}/original`, status: "uploaded" }] as T;
      if (p.startsWith("studio_transcripts")) return (options.transcript ? [{ duration_seconds: 1 }] : []) as T;
      if (p.startsWith("studio_workspace_ai_credentials")) return (options.credential === false ? [] : [{ ciphertext: "c", iv: "i", auth_tag: "t", key_id: "v1" }]) as T;
      if (p.startsWith("studio_transcript_chunks")) return [...chunks.keys()].sort().map(i => ({ chunk_index: i, duration_seconds: chunks.get(i) })) as T;
      throw new Error(`unexpected ${p}`);
    },
    presignWorkerRead: async key => `https://r2.example/${key}?sig=SECRET`,
    decryptKey: () => "sk-test-key",
    probe: async () => ({ durationSeconds: options.duration ?? 1500, hasAudio: true }),
    extractChunks: async (_url, dir) => Array.from({ length: Math.ceil((options.duration ?? 1500) / CHUNK_SECONDS) }, (_, i) => path.join(dir, `chunk-${String(i).padStart(5, "0")}.ogg`)),
    transcribe: async file => {
      const index = Number(path.basename(file).slice(6, 11));
      if (index === options.failAt) throw new StudioProviderRejectedError("provider_rate_limited", "OpenAI is rate limiting.", true);
      transcribed.push(file); return { text: `part ${index}`, language: "english", segments: [{ start: 1, end: 2, text: `part ${index}` }] };
    },
    now: () => new Date("2026-10-24T12:00:00Z"),
  };
  return { deps, rpcs, transcribed };
}

test("durably reserves each chunk, commits results with offsets and assembles", async () => {
  const f = fakeDeps();
  const result = await createTranscribeUploadHandler(f.deps)(job, context);
  assert.deepEqual(result, { uploadId, chunks: 3, durationSeconds: 1500 });
  const starts = f.rpcs.filter(r => r[0] === "studio_begin_transcription_attempt").map(r => r[1]);
  assert.deepEqual(starts.map(s => [s.p_chunk_index, s.p_duration_seconds]), [[0, 600], [1, 600], [2, 300]]);
  assert.ok(starts.every(s => s.p_job_id === "j" && s.p_lease_token === "claim-1" && s.p_worker_id === "w"));
  const saves = f.rpcs.filter(r => r[0] === "studio_finish_transcription_attempt").map(r => r[1]);
  assert.deepEqual(saves.map(s => [s.p_attempt_id, s.p_segments[0].start]), [["0", 1], ["1", 601], ["2", 1201]]);
  assert.equal(f.rpcs.at(-1)![0], "studio_finish_upload_transcript"); assert.equal(f.rpcs.at(-1)![1].p_language, "english");
});

test("a definitive rejection closes only that attempt, and retry skips saved chunks", async () => {
  const first = fakeDeps({ failAt: 1 });
  await assert.rejects(createTranscribeUploadHandler(first.deps)(job, context), (e: StudioJobError) => e.code === "provider_rate_limited" && e.retryable);
  assert.equal(first.rpcs.find(r => r[0] === "studio_close_transcription_attempt")![1].p_rejected, true);
  assert.ok(!first.rpcs.some(r => r[0] === "studio_save_transcript"));
  const retry = fakeDeps({ done: [0] });
  await createTranscribeUploadHandler(retry.deps)(job, context);
  assert.equal(retry.rpcs[0][1].p_chunk_index, 1);
  assert.deepEqual(retry.transcribed.map(f => path.basename(f)), ["chunk-00001.ogg", "chunk-00002.ogg"]);
});

test("missing key fails permanently; a reached cap retries at the next UTC month; done uploads are skipped", async () => {
  await assert.rejects(createTranscribeUploadHandler(fakeDeps({ credential: false }).deps)(job, context), (e: StudioJobError) => e.code === "openai_key_missing" && !e.retryable);
  const capped = fakeDeps({ reserve: null });
  await assert.rejects(createTranscribeUploadHandler(capped.deps)(job, context),
    (e: StudioJobError) => e.code === "ai_budget_exhausted" && e.retryable && e.retryAfterSeconds === 7 * 86400 + 12 * 3600 + 60);
  assert.equal(capped.transcribed.length, 0);
  const done = fakeDeps({ transcript: true });
  assert.deepEqual(await createTranscribeUploadHandler(done.deps)(job, context), { uploadId, alreadyTranscribed: true });
  assert.equal(done.rpcs.length, 0);
});

test("lost provider responses keep their durable hold and block automatic replay", async () => {
  const f = fakeDeps({ duration: 10 });
  f.deps.transcribe = async () => { throw new Error("response lost after send"); };
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context), (e: StudioJobError) => e.code === "transcription_outcome_uncertain" && !e.retryable);
  assert.ok(f.rpcs.some(r => r[0] === "studio_begin_transcription_attempt"));
  assert.ok(!f.rpcs.some(r => r[0] === "studio_release_ai_spend"));
  const calls = f.transcribed.length;
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context), (e: StudioJobError) => e.code === "transcription_outcome_uncertain");
  assert.equal(f.transcribed.length, calls);
});

test("a failed result commit never releases a paid hold or resends the chunk", async () => {
  const f = fakeDeps({ duration: 10 });
  const rest = f.deps.rest;
  f.deps.rest = async <T>(p: string, init?: RequestInit): Promise<T> => {
    if (p === "rpc/studio_finish_transcription_attempt" || p === "rpc/studio_save_transcript_chunk") throw new Error("commit unavailable");
    return rest<T>(p, init);
  };
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context));
  assert.equal(f.transcribed.length, 1);
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context), (e: StudioJobError) => e.code === "transcription_outcome_uncertain");
  assert.equal(f.transcribed.length, 1);
  assert.ok(f.rpcs.some(r => r[0] === "studio_begin_transcription_attempt"));
  assert.ok(!f.rpcs.some(r => r[0] === "studio_release_ai_spend"));
});

test("a committed result with a lost database response is reused without another provider call", async () => {
  const f = fakeDeps({ duration: 10 });
  const rest = f.deps.rest;
  let loseResponse = true;
  f.deps.rest = async <T>(p: string, init?: RequestInit): Promise<T> => {
    const result = await rest<T>(p, init);
    if (p === "rpc/studio_finish_transcription_attempt" && loseResponse) {
      loseResponse = false;
      throw new Error("commit response lost");
    }
    return result;
  };
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context));
  await createTranscribeUploadHandler(f.deps)(job, context);
  assert.equal(f.transcribed.length, 1);
});

test("lease loss during a provider call cannot save the result or send another chunk", async () => {
  const f = fakeDeps();
  const controller = new AbortController();
  f.deps.transcribe = async () => { controller.abort(); return { text: "late", language: null, segments: [] }; };
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, { ...context, signal: controller.signal }), (e: StudioJobError) => e.code === "transcription_outcome_uncertain");
  assert.equal(f.rpcs.filter(r => r[0] === "studio_begin_transcription_attempt").length, 1);
  assert.equal(f.rpcs.filter(r => r[0] === "studio_finish_transcription_attempt").length, 0);
});

test("billing reconciliation alone does not authorize a replacement provider call", async () => {
  const f = fakeDeps({ duration: 10 });
  const rest = f.deps.rest;
  f.deps.rest = async <T>(p: string, init?: RequestInit): Promise<T> => {
    if (p === "rpc/studio_begin_transcription_attempt") return { outcome: "reconciled" } as T;
    return rest<T>(p, init);
  };
  await assert.rejects(createTranscribeUploadHandler(f.deps)(job, context), (e: StudioJobError) => e.code === "transcription_replacement_required" && !e.retryable);
  assert.equal(f.transcribed.length, 0);
});

test("OpenAI responses are classified without exposing the key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-openai-"));
  const file = path.join(dir, "chunk-00000.ogg");
  try {
    execFileSync("sh", ["-c", `printf audio > "${file}"`]);
    const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
    const ok = await transcribeChunk(file, "sk-x", context.signal, reply(200, { text: "Hello", language: "english", segments: [{ start: 0, end: 1.5, text: "Hello" }, { bad: true }] }));
    assert.deepEqual(ok, { text: "Hello", language: "english", segments: [{ start: 0, end: 1.5, text: "Hello" }] });
    for (const [status, code, retryable] of [[401, "openai_key_rejected", false], [429, "provider_rate_limited", true], [503, "provider_unavailable", true], [400, "provider_rejected_input", false]] as const) {
      await assert.rejects(transcribeChunk(file, "sk-x", context.signal, reply(status, {}, { "retry-after": "42" })), (e: StudioJobError) => e.code === code && e.retryable === retryable && !e.message.includes("sk-x"));
    }
    for (const fetcher of [reply(408), reply(200, {}), reply(200, { text: "x", segments: {} }),
      (async () => { throw new Error("lost response"); }) as typeof fetch]) {
      await assert.rejects(transcribeChunk(file, "sk-x", context.signal, fetcher), e => !(e instanceof StudioProviderRejectedError));
    }
    await assert.rejects(transcribeChunk(file, "sk-x", context.signal, reply(429, {}, { "retry-after": "42" })), (e: StudioJobError) => e.retryAfterSeconds === 42);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("real ffmpeg: probes and splits a video into small mono Opus chunks", { skip: !commandExists("ffmpeg") }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-ffmpeg-"));
  try {
    const source = path.join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=25", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=25",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", source]);
    const probe = await probeMedia(source, context.signal);
    assert.equal(probe.hasAudio, true); assert.ok(Math.abs(probe.durationSeconds - 25) < 0.2);
    const out = path.join(dir, "out"); execFileSync("mkdir", [out]);
    const chunks = await extractAudioChunks(source, out, 10, context.signal);
    assert.equal(chunks.length, 3);
    for (const chunk of chunks) assert.ok((await stat(chunk)).size < 64 * 1024);
    assert.deepEqual((await readdir(out)).sort(), ["chunk-00000.ogg", "chunk-00001.ogg", "chunk-00002.ogg"]);
    const silent = path.join(dir, "silent.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2", "-c:v", "libx264", silent]);
    assert.equal((await probeMedia(silent, context.signal)).hasAudio, false);
    await assert.rejects(probeMedia(path.join(dir, "missing.mp4"), context.signal), (e: StudioJobError) => e.code === "media_unreadable");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function commandExists(name: string) { try { execFileSync("which", [name], { stdio: "ignore" }); return true; } catch { return false; } }
