import test from "node:test";
import assert from "node:assert/strict";
import { describeVideoState, isWorking } from "./video-state-text";

const run = (over: Record<string, unknown> = {}) => ({ status: "queued", method: null, error_code: null, error_message: null, segment_count: 0, visual_status: "pending", visual_error: null, relevance: null, ...over });
test("a queued run says why it waits, including behind another Mac job", () => {
  assert.match(describeVideoState(run(), "mac_busy", "drawing a character sheet").text, /current job \(drawing a character sheet\)/);
  assert.match(describeVideoState(run(), "mac_offline").text, /come online/);
  assert.match(describeVideoState(run(), null).text, /Your Mac picks this up/);
  assert.match(describeVideoState(run({ error_message: "YouTube is rate-limiting this Mac." }), null).text, /retry by itself: YouTube/);
});
test("cancelled and failed runs always carry the reason and the next step", () => {
  const cancelled = describeVideoState(run({ status: "cancelled", error_message: "Cancelled from Jobs." }), null);
  assert.equal(cancelled.tone, "bad"); assert.match(cancelled.text, /Cancelled: Cancelled from Jobs\. Press Transcribe again/);
  assert.match(describeVideoState(run({ status: "cancelled" }), null).text, /no reason was recorded/);
  assert.match(describeVideoState(run({ status: "failed", error_message: "Slow." }), null).text, /Failed: Slow\. Press Transcribe again, or paste a transcript/);
});
test("done states and live-run detection", () => {
  assert.match(describeVideoState(run({ status: "ready", method: "youtube-captions-fallback" }), null).text, /YouTube captions/);
  assert.equal(isWorking(run({ status: "running" })), true); assert.equal(isWorking(run({ status: "cancelled" })), false);
});

import { videoProgressView } from "./video-state-text";
test("a running run shows an honest checklist, overall percent and staleness", () => {
  const at = "2026-11-28T08:00:00.000Z"; const now = Date.parse(at) + 30_000;
  const view = videoProgressView({ status: "running", progress: { phase: "transcribe", percent: 50, detail: "Transcribing on your Mac", at, since: "2026-11-28T07:59:00.000Z" } }, now)!;
  assert.equal(view.percent, 38); assert.equal(view.stalledSeconds, 30); assert.equal(view.phaseSeconds, 90);
  assert.deepEqual(view.steps.map(s => s.state), ["done", "done", "active", "todo", "todo", "todo", "todo"]);
  assert.match(view.steps[2].detail!, /50%/);
  assert.equal(videoProgressView({ status: "queued", progress: null }), null);
  const fallback = videoProgressView({ status: "running", progress: { phase: "captions", percent: null, detail: "Using YouTube's captions instead", at, since: at } }, now)!;
  assert.equal(fallback.fallback, true); assert.match(fallback.steps[2].label, /YouTube's captions/);
});
test("a running run from an older companion explains the missing progress", () => {
  assert.match(describeVideoState(run({ status: "running" }), null).text, /does not report progress/);
});
