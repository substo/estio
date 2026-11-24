import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAssets, classifyUpload } from "./assets";
import { clipStarter, focusedInstruction, MAX_INSTRUCTION } from "./clip-actions";
import { describeMac } from "./mac-status";
import { defaultMode, parseMode } from "./modes";
import { jobStepper } from "./stepper";
import { isTimelineSnapshot, layoutClip, reduceTimeline, TIMELINE_MAX_CLIPS } from "./timeline";

const up = (id: string, name: string, extra: Partial<Parameters<typeof groupAssets>[0][number]> = {}) => ({ id, name, contentType: name.endsWith(".mp3") ? "audio/mpeg" : "video/mp4", byteSize: 5_000_000, createdAt: "2026-11-23T11:40:00Z", status: "uploaded", ...extra });

test("modes: video -> edit, otherwise script; unknown values rejected", () => {
  assert.equal(defaultMode({ hasScript: false, hasVideo: false }), "script");
  assert.equal(defaultMode({ hasScript: true, hasVideo: false }), "script");
  assert.equal(defaultMode({ hasScript: true, hasVideo: true }), "edit");
  assert.equal(parseMode("details"), "details"); assert.equal(parseMode("x"), null);
});

test("assets are grouped by provenance; narration collapses per generation; unfinished uploads wait under attention", () => {
  const g = groupAssets([
    up("1", "shot.mp4"), up("2", "Edited video 2026-11-23 1325.mp4"),
    ...[1, 2, 3].map(i => up(`n${i}`, `Narration 2026-11-23 1140 0${i}.mp3`)), up("n9", "Narration 2026-11-22 0900 01.mp3"),
    up("bad", "late.mov", { status: "awaiting_upload" }),
  ], [{ id: "p1", name: "Edited video 2026-11-23 1222.mp4", byteSize: 9 }, { id: "bad", name: "late.mov", byteSize: 1 }]);
  assert.deepEqual(g.footage.map(a => a.id), ["1"]); assert.match(g.footage[0].provenance, /^You uploaded/);
  assert.deepEqual(g.exports.map(a => a.id), ["2"]); assert.match(g.exports[0].provenance, /^Made from your script/);
  assert.equal(g.narration.length, 2); assert.equal(g.narration[0].count, 3); assert.match(g.narration[0].provenance, /^Generated narration/);
  assert.deepEqual(g.attention.map(a => a.id).sort(), ["bad", "p1"]);
  assert.equal(classifyUpload("Narration x.mp3"), "narration");
});

test("timeline reduction: top-to-bottom order, bounded, labels from text, invalid clips dropped", () => {
  const clip = (start: number, duration: number, name = "", content: Record<string, unknown> = { solid: {} }) => ({ id: "c", name, start, duration, content });
  const project = { videoTracks: [{ name: "Screen", clips: [clip(0, 3, "bg")] }, { name: "Text", clips: [clip(1, 2, "", { text: { text: "Hello   there" } }), clip(5, 0), clip(-1, 2)] }], audioTracks: [{ name: "Voice", clips: [clip(0, 9, "v", { media: {} })] }] };
  const t = reduceTimeline(project)!;
  assert.deepEqual(t.tracks.map(x => x.n), ["Text", "Screen", "Voice"]);
  assert.equal(t.d, 9); assert.equal(t.tracks[0].c.length, 1); assert.equal(t.tracks[0].c[0].l, "Hello there"); assert.equal(t.tracks[2].k, "audio");
  assert.ok(isTimelineSnapshot(t));
  const many = { videoTracks: [{ name: "Text", clips: Array.from({ length: 500 }, (_, i) => clip(i, 1, "x".repeat(60))) }], audioTracks: [] };
  const big = reduceTimeline(many)!; assert.equal(big.tracks[0].c.length, TIMELINE_MAX_CLIPS); assert.equal(big.tracks[0].c[0].l.length, 28);
  assert.equal(reduceTimeline(null), null); assert.equal(isTimelineSnapshot({ d: 1, tracks: [{ n: "a", k: "x", c: [] }] }), false);
});

test("layout keeps clips inside the row", () => {
  const l = layoutClip({ s: 50, e: 100, l: "", k: "" }, 100); assert.equal(l.left, 50); assert.equal(l.width, 50);
  assert.ok(layoutClip({ s: 0, e: 0.01, l: "", k: "" }, 100).width >= 0.6);
});

test("stepper reports narration progress, queueing, editing and failure honestly", () => {
  const n = { status: "running", done: 3, total: 6, message: null, jobId: null, createdAt: new Date().toISOString() } as const;
  const a = (status: "queued" | "running" | "succeeded" | "failed") => ({ jobId: "j", status, message: status === "failed" ? "No export" : null, summary: null, createdAt: new Date().toISOString() });
  assert.equal(jobStepper({ narration: n, assembly: null })![0].detail, "3 of 6 voiced");
  assert.equal(jobStepper({ narration: null, assembly: a("queued") })!.find(s => s.key === "queued")!.state, "active");
  assert.equal(jobStepper({ narration: null, assembly: a("running") })!.find(s => s.key === "editing")!.state, "active");
  const f = jobStepper({ narration: null, assembly: a("failed") })!; assert.equal(f.find(s => s.key === "editing")!.state, "failed"); assert.equal(f.find(s => s.key === "editing")!.detail, "No export");
  assert.equal(jobStepper({ narration: null, assembly: a("succeeded") }), null);
  assert.equal(jobStepper({ narration: null, assembly: null }), null);
});

test("clip instructions name the clip and stay bounded", () => {
  const sel = { track: "Text", clip: { s: 12, e: 18, l: "TIP 1", k: "text" } };
  // Choosing an action only starts a message; the user finishes it (how long, how, what instead).
  assert.match(clipStarter("trim"), /^Trim 2 seconds off the end of this clip\.$/);
  assert.match(clipStarter("replace"), /^Replace this clip with $/);
  assert.match(clipStarter("delete"), /Delete this clip/);
  assert.match(clipStarter("retake"), /Retake the audio/);
  assert.equal(clipStarter("ask"), "");
  // What is sent names the clip and carries the user's own words, bounded.
  assert.match(focusedInstruction(sel, "Trim 3 seconds off the start"), /Text track.*"TIP 1".*0:12 to 0:18.*Trim 3 seconds off the start/);
  assert.ok(focusedInstruction(sel, "x".repeat(5000)).length <= MAX_INSTRUCTION);
});

test("Mac status names what is missing and never echoes unsafe text", () => {
  const base = { hasDevice: true, processing: true, paused: false, online: true, assemblyReady: true, missing: [] };
  assert.equal(describeMac(base).tone, "ok");
  assert.equal(describeMac({ ...base, hasDevice: false }).label, "No Mac connected");
  assert.equal(describeMac({ ...base, processing: false }).label, "Mac processing is off");
  assert.equal(describeMac({ ...base, online: false }).label, "Mac is offline");
  assert.equal(describeMac({ ...base, assemblyReady: false, missing: ["Claude sign-in", "ffprobe", "<script>x</script>"] }).label, "Mac needs Claude sign-in, ffprobe");
  assert.equal(describeMac({ ...base, assemblyReady: null }).label, "Mac is starting");
});

test("the music bed and whoosh made for Make video are plumbing, not assets to browse", () => {
  const g = groupAssets([up("1", "shot.mp4"), up("2", "Narration sound-music 90s 2026-11-24 1030.mp3"), up("3", "Narration sound-sfx 2026-11-24 1030.mp3")], []);
  assert.equal(g.footage.length, 1); assert.equal(g.narration.length, 0);
});
