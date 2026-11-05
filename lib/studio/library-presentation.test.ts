import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryHref, libraryPlatform, libraryPresentation } from "./library-presentation";
const source = { source_url: null, summary: null };
test("infers platforms only from matching source hosts", () => {
  assert.equal(libraryPlatform(null, "https://youtube.com.evil.test/watch"), "other");
  assert.equal(libraryPlatform(null, "https://m.youtube.com/watch?v=abcdefghijk"), "youtube");
  assert.equal(libraryPlatform("Twitter"), "x");
});
test("preserves native short formats and safe deterministic YouTube thumbnails", () => {
  const item = libraryPresentation({ ...source, source_url: "https://www.youtube.com/shorts/abcdefghijk" });
  assert.equal(item.portrait, true);
  assert.equal(item.thumbnail, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  assert.equal(libraryPresentation({ ...source, source_url: "https://youtube.com/watch?v=abcdefghijk" }).portrait, false);
});
test("reads imported aliases without inventing summaries", () => {
  const item = libraryPresentation({ ...source, payload: { thumbnail_url: "https://example.com/thumb.jpg", channel_name: "Creator", summary_status: "pending", format: "reel", url: "https://instagram.com/reel/123" } });
  assert.equal(item.creator, "Creator"); assert.equal(item.portrait, true);
  assert.equal(item.summary, undefined); assert.equal(item.summaryStatus, "pending");
  assert.equal(libraryPresentation({ ...source, payload: { thumbnailUrl: "javascript:alert(1)" } }).thumbnail, null);
});
test("pagination preserves view and platform, tab/filter resets omit page", () => {
  assert.equal(libraryHref("channels", "youtube", 2), "/studio/library?view=channels&platform=youtube&page=2");
  assert.equal(libraryHref("sources", ""), "/studio/library?view=sources");
});
test("labels evidence and legacy notes separately from generated summaries", () => {
  assert.equal(libraryPresentation({ ...source, summary: "Old research note" }).summaryLabel, "Research note");
  assert.equal(libraryPresentation({ ...source, payload: { description: "Publisher copy" } }).summaryLabel, "Source description");
  assert.equal(libraryPresentation({ ...source, summary: "Research note", payload: { aiSummary: "Generated", summaryBasis: "transcript" } }).summaryLabel, "AI summary · transcript");
  assert.equal(libraryPresentation({ ...source, payload: { summaryStatus: "not_generated" } }).waiting, true);
});
test("rejects private and literal image hosts in old payloads", () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "[::1]", "localhost", "host.internal", "host.home.arpa", "2130706433"]) {
    assert.equal(libraryPresentation({ ...source, payload: { thumbnailUrl: `https://${host}/a.jpg` } }).thumbnail, null, host);
  }
});
test("recognizes Facebook short links and truthful worker states", () => {
  assert.equal(libraryPlatform(null, "https://fb.watch/example/"), "facebook");
  assert.equal(libraryPlatform(null, "https://fb.watch.evil.test/example/"), "other");
  for (const [summaryStatus, message] of [["waiting_for_device", "connected computer"], ["waiting_for_capacity", "subscription capacity"], ["uncertain", "uncertain"], ["stale", "out of date"]]) {
    assert.ok(libraryPresentation({ ...source, payload: { summaryStatus } }).statusMessage?.includes(message));
  }
});

test("AI summary takes priority without reclassifying legacy research notes", () => {
  const item = libraryPresentation({ ...source, summary: "Human note", payload: { aiSummary: "Generated brief", summaryBasis: "description", summary: "Human note" } });
  assert.equal(item.summary, "Generated brief");
  assert.equal(item.summaryLabel, "AI summary · description");
  assert.equal(libraryPresentation({ ...source, summary: "Human note", payload: { summaryBasis: "transcript" } }).summaryLabel, "Research note");
});

test("no_evidence explains unavailable description or transcript", () => {
  assert.equal(libraryPresentation({ ...source, payload: { summaryStatus: "no_evidence" } }).statusMessage, "Source description or transcript unavailable.");
});
