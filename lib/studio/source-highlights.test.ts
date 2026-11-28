import test from "node:test";
import assert from "node:assert/strict";
import { HIGHLIGHT_MARK, highlightLabel, splitSentences, stripHighlights, summaryView, textKey, withHighlights, type SourceHighlight } from "./source-highlights";

const h = (over: Partial<SourceHighlight>): SourceHighlight => ({ kind: "transcript", key: "133", excerpt: "Tier one is free.", at: 133, ...over });
test("highlights reach the agent with their source and timestamp, and are stripped from what the owner sees", () => {
  const out = withHighlights("What matters here?", [h({}), h({ kind: "summary", key: "k", excerpt: "A short summary.", at: null }), h({ kind: "comment", key: "c", excerpt: "@a: nice", at: null })], 2000);
  assert.match(out, /Transcript 2:13: "Tier one is free\."/); assert.match(out, /Summary: "A short summary\."/); assert.match(out, /Comment: "@a: nice"/);
  assert.equal(stripHighlights(out), "What matters here?"); assert.equal(stripHighlights("plain"), "plain");
});
test("the message is never cut and the limit is never exceeded", () => {
  const long = "x".repeat(1990); const many = Array.from({ length: 30 }, (_, i) => h({ key: String(i), excerpt: "line ".repeat(40) }));
  const out = withHighlights(long, many, 2000); assert.ok(out.length <= 2000); assert.ok(out.startsWith(long));
  assert.equal(withHighlights("hi", [], 2000), "hi"); assert.equal(withHighlights("   ", [h({})], 2000), "   ");
  const mid = withHighlights("hi", many, 2000); assert.ok(mid.length <= 2000); assert.ok(mid.includes(HIGHLIGHT_MARK));
});
test("labels, sentence splitting and stable text keys", () => {
  assert.equal(highlightLabel({ kind: "slide", at: 3725 }), "Slide 1:02:05"); assert.equal(highlightLabel({ kind: "description", at: null }), "Description");
  assert.deepEqual(splitSentences("One. Two is longer! Three?"), ["One.", "Two is longer!", "Three?"]); assert.equal(textKey(" same "), textKey("same")); assert.notEqual(textKey("a"), textKey("b"));
});
test("the summary starts by itself once, shows a failure with a retry, and refreshes a description-only summary when a transcript arrives", () => {
  assert.equal(summaryView({}, true, true).request, "request");
  assert.equal(summaryView({}, false, false).request, null);
  assert.deepEqual([summaryView({ summaryStatus: "waiting_for_device" }, true, true).state, summaryView({ summaryStatus: "waiting_for_device" }, true, true).request], ["generating", null]);
  const failed = summaryView({ summaryStatus: "failed" }, true, true); assert.equal(failed.state, "failed"); assert.equal(failed.request, null, "never retried in a loop");
  assert.equal(summaryView({ summaryStatus: "stale" }, true, true).request, "retry");
  const ready = summaryView({ aiSummary: "S.", summaryStatus: "ready", summaryBasis: "transcript" }, true, true); assert.equal(ready.state, "ready"); assert.equal(ready.request, null);
  assert.equal(summaryView({ aiSummary: "S.", summaryStatus: "ready", summaryBasis: "description" }, true, true).request, "request");
  assert.equal(summaryView({ aiSummary: "S.", summaryStatus: "ready", summaryBasis: "description" }, false, true).request, null);
});
