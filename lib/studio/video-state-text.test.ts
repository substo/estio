import test from "node:test";
import assert from "node:assert/strict";
import { describeVideoState, isWorking } from "./video-state-text";

const run = (over: Record<string, unknown> = {}) => ({ status: "queued", method: null, error_code: null, error_message: null, segment_count: 0, visual_status: "pending", visual_error: null, relevance: null, ...over });
test("a queued run says why it waits, including behind another Mac job", () => {
  assert.match(describeVideoState(run(), "mac_busy", "drawing a character sheet").text, /current job \(drawing a character sheet\)/);
  assert.match(describeVideoState(run(), "mac_offline").text, /come online/);
  assert.match(describeVideoState(run(), null).text, /Step 1 of 4/);
  assert.match(describeVideoState(run({ error_message: "YouTube is rate-limiting this Mac." }), null).text, /retry by itself: YouTube/);
});
test("a running run walks through its steps", () => {
  assert.match(describeVideoState(run({ status: "running" }), null).text, /Step 2 of 4/);
  assert.match(describeVideoState(run({ status: "running", segment_count: 40 }), null).text, /Step 3 of 4.*slides/);
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
