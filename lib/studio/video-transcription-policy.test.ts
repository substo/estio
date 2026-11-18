import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RELEVANCE_THRESHOLDS, buildRelevancePrompt, canonicalYoutubeVideo, chunkSegments, formatTimestamp, gateOutcome, normalizeSegments, relevanceBand, relevanceResultSchema,
  summarizeVideoTools, timestampedTranscript, validThresholds, videoSetupGuide, VIDEO_LIMITS,
} from "./video-transcription-policy";
import { runVideoFrameOperation, type FrameStore } from "./video-frames";
import { buildRelevanceContext, enqueueDiscoveredVideos } from "./video-discovery";
import type { StudioDb } from "./db";

test("default thresholds are documented, valid and tunable; bands are derived from score and the relevant flag", () => {
  assert.deepEqual({ ...DEFAULT_RELEVANCE_THRESHOLDS }, { auto: 70, review: 40 });
  assert.ok(validThresholds(DEFAULT_RELEVANCE_THRESHOLDS));
  for (const bad of [{ auto: 40, review: 70 }, { auto: 50, review: 50 }, { auto: 101, review: 40 }, { auto: 70, review: 0 }, { auto: NaN, review: 1 }]) assert.equal(validThresholds(bad), false);
  const band = (score: number, relevant = true, t = DEFAULT_RELEVANCE_THRESHOLDS) => relevanceBand({ score, relevant }, t);
  assert.deepEqual([band(100), band(70), band(69.9), band(40), band(39.9), band(0), band(99, false), band(30, false)], ["high", "high", "review", "review", "skip", "skip", "review", "skip"]);
  assert.equal(band(60, true, { auto: 55, review: 20 }), "high");
  assert.deepEqual([gateOutcome("high"), gateOutcome("review"), gateOutcome("skip")], ["transcribed", "relevance_review", "relevance_skipped"]);
});

test("relevance result is strictly structured: relevant, score, reason, matches", () => {
  assert.ok(relevanceResultSchema.parse({ relevant: true, score: 50, reason: "Why", matches: [] }));
  for (const bad of [{ relevant: "yes", score: 5, reason: "x", matches: [] }, { relevant: true, score: 101, reason: "x", matches: [] }, { relevant: true, score: 5, reason: "", matches: [] },
    { relevant: true, score: 5, reason: "x", matches: ["a", "b", "c", "d", "e", "f"] }, { relevant: true, score: 5, reason: "x", matches: [], extra: 1 }, { score: 5, reason: "x", matches: [] }]) assert.throws(() => relevanceResultSchema.parse(bad));
});

test("only https YouTube video URLs with an 11-character id are accepted, and always canonicalized", () => {
  const ok = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  for (const input of [ok, "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&t=5", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=x", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ/", "https://www.youtube.com/embed/dQw4w9WgXcQ"])
    assert.deepEqual(canonicalYoutubeVideo(input), { videoId: "dQw4w9WgXcQ", url: ok });
  for (const input of ["http://youtu.be/dQw4w9WgXcQ", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/playlist?list=PLx", "https://www.youtube.com/@channel", "file:///etc/passwd", "--exec=rm", "", 42, null, "https://www.youtube.com/watch?v=" + "a".repeat(2000)])
    assert.equal(canonicalYoutubeVideo(input), null, String(input).slice(0, 60));
});

test("saved transcript is timestamped [HH:MM:SS] and chunks stay within the device request bounds", () => {
  assert.equal(formatTimestamp(0), "00:00:00"); assert.equal(formatTimestamp(3725.9), "01:02:05");
  assert.equal(timestampedTranscript([{ start: 5, end: 6, text: " Hello " }, { start: 3700, end: 3701, text: "Late" }]), "[00:00:05] Hello\n[01:01:40] Late");
  const many = Array.from({ length: 1000 }, (_, i) => ({ start: i, end: i + 1, text: `Sentence ${i} `.repeat(8).trim() }));
  const chunks = chunkSegments(many);
  assert.equal(chunks.flat().length, 1000);
  for (const chunk of chunks) { assert.ok(chunk.length <= VIDEO_LIMITS.segmentsPerChunk); assert.ok(Buffer.byteLength(JSON.stringify(chunk)) <= VIDEO_LIMITS.chunkBytes + 200); }
  assert.ok(chunks.length <= VIDEO_LIMITS.maxChunks);
  assert.deepEqual(chunkSegments([]), []);
});

test("raw ASR segments are normalized, ordered and bounded", () => {
  const out = normalizeSegments([{ start: 9, end: 12, text: "b" }, { start: 1, end: 2, text: "  a   a " }, { start: -1, end: 2, text: "neg" }, { start: 1, end: 2, text: "" }, { start: "x", end: 2, text: "bad" }, null, { start: 5, end: 1, text: "back" }, { start: 99999, end: 99999, text: "far" }]);
  assert.deepEqual(out.map(s => [s.start, s.end, s.text]), [[1, 2, "a a"], [5, 5, "back"], [9, 12, "b"]]);
  assert.deepEqual(normalizeSegments("nope"), []);
  const huge = normalizeSegments(Array.from({ length: 400 }, (_, i) => ({ start: i, end: i, text: "y".repeat(2000) })));
  assert.ok(huge.reduce((n, s) => n + s.text.length, 0) <= VIDEO_LIMITS.maxTranscriptChars);
});

test("relevance prompt carries every context source, bounds long fields and tells the model the data is untrusted", () => {
  const prompt = buildRelevancePrompt({ title: "T".repeat(500), description: "D".repeat(9000), channel: "C", captions: "K".repeat(9000) },
    { approvedTitles: ["Lib A"], pinnedKnowledge: ["Pin B"], profile: { offer: "Pricing courses" } }, { auto: 70, review: 40 });
  for (const needle of ["Lib A", "Pin B", "Pricing courses", "untrusted data", "cannot watch the video", "No tools or file access", "70", "40"]) assert.ok(prompt.includes(needle), needle);
  assert.ok(prompt.length < 14_000);
});

test("tool inventory marks readiness from required tools; guidance names exact commands", () => {
  const ready = summarizeVideoTools({ ytDlp: "1", ffmpeg: "1", python: "3.11", parakeet: "0.3", model: "downloaded" });
  assert.equal(ready.ready, true); assert.deepEqual(ready.missing, ["ffprobe", "tesseract"]);
  const none = summarizeVideoTools({ ffmpeg: "1", ffprobe: "1", tesseract: "1" });
  assert.equal(none.ready, false); assert.deepEqual(none.missing, ["ytDlp", "python", "parakeet", "model"]);
  assert.match(videoSetupGuide.ytDlp, /brew install yt-dlp/); assert.match(videoSetupGuide.model, /studio-companion-transcription-setup\.sh install/);
});

const frameStore = (digests: Record<string, { sha256: string; byteSize: number } | null | "throw">): FrameStore & { signed: string[]; read: string[] } => {
  const signed: string[] = [], read: string[] = [];
  return { bucket: "studio-private", signed, read,
    presignUpload: async ({ key, contentType, byteSize }) => { assert.equal(contentType, "image/jpeg"); assert.ok(byteSize > 0); signed.push(key); return `https://r2.example/${key}`; },
    readDigest: async key => { read.push(key); const v = digests[key]; if (v === "throw") throw new Error("r2"); return v ?? null; } };
};
test("frame reserve signs uploads only for pending frames; verify binds only bytes the server read back and matched", async () => {
  const store = frameStore({ "w/a": { sha256: "s1", byteSize: 10 }, "w/b": { sha256: "WRONG", byteSize: 10 }, "w/c": null, "w/d": { sha256: "s4", byteSize: 99 }, "w/e": "throw" });
  const reserve = await runVideoFrameOperation("video_frames_reserve", async () => [{ index: 0, objectKey: "w/a", status: "pending", byteSize: 10 }, { index: 1, objectKey: "w/old", status: "verified", byteSize: 5 }], store);
  assert.deepEqual(reserve, [{ index: 0, status: "pending", uploadUrl: "https://r2.example/w/a", expiresInSeconds: 900 }, { index: 1, status: "verified" }]);
  const observed: unknown[] = [];
  const verify = await runVideoFrameOperation("video_frames_verify", async seen => {
    if (seen === undefined) return [{ index: 0, objectKey: "w/a", sha256: "s1", byteSize: 10 }, { index: 1, objectKey: "w/b", sha256: "s2", byteSize: 10 }, { index: 2, objectKey: "w/c", sha256: "s3", byteSize: 10 },
      { index: 3, objectKey: "w/d", sha256: "s4", byteSize: 10 }, { index: 4, objectKey: "w/e", sha256: "s5", byteSize: 10 }];
    observed.push(seen); return 1;
  }, store);
  assert.deepEqual(verify, { requested: 5, verified: 1, totalVerified: 1, missing: 4 });
  assert.deepEqual(observed, [{ bucket: "studio-private", frames: [{ index: 0, sha256: "s1", byteSize: 10 }] }]);
  const none = await runVideoFrameOperation("video_frames_verify", async seen => seen === undefined ? [{ index: 0, objectKey: "w/c", sha256: "s", byteSize: 1 }] : (() => { throw new Error("must not bind"); })(), store);
  assert.deepEqual(none, { requested: 1, verified: 0, totalVerified: 0, missing: 1 });
});

test("discovery context is bounded and cannot fail discovery when the profile is unavailable; enqueue passes the lease fence and pinned thresholds", async () => {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const db = { rows: async (q: { sql?: string; strings?: string[] }) => (String(q.strings?.join("?") ?? q.sql).includes("studio_records") ? [{ title: "T".repeat(300) }] : [{ statement: "S".repeat(500) }]),
    call: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { videos: [] }; } } as unknown as StudioDb;
  const context = await buildRelevanceContext(db, "loc", async () => { throw new Error("no profile"); }).catch(() => "threw");
  assert.equal(context, "threw", "a loader is expected to swallow its own errors");
  const safe = await buildRelevanceContext(db, "loc", async () => ({}));
  assert.equal(safe.approvedTitles![0].length, 120); assert.equal(safe.pinnedKnowledge![0].length, 200);
  await enqueueDiscoveredVideos(db, { location: "loc", run: "r", job: "j", worker: "w", lease: "l" }, async () => ({ offer: "Courses" }));
  assert.equal(calls[0].fn, "studio_enqueue_discovered_video_transcriptions");
  assert.deepEqual({ ...calls[0].args, p_context: JSON.parse(JSON.stringify(calls[0].args!.p_context)) }, { p_location: "loc", p_run: "r", p_job: "j", p_worker: "w", p_lease: "l",
    p_context: { thresholds: { auto: 70, review: 40 }, context: { approvedTitles: ["T".repeat(120)], pinnedKnowledge: ["S".repeat(200)], profile: { offer: "Courses" } } } });
});
