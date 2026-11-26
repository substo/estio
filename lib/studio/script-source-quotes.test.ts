import assert from "node:assert/strict";
import { test } from "node:test";
import { citationClipRange, sourceQuoteCue } from "./script-source-quotes";
import { parseScriptTimeline, sameScriptNarration } from "./video-assembly/script";

test("only a recorded speech range prefills both ends; a frame never creates a timed clip", () => {
  assert.deepEqual(citationClipRange(12.23, 16.24, false), { start: 12.23, end: 16.24 });
  assert.deepEqual(citationClipRange(12, 16, true), { start: 12, end: null });
  assert.deepEqual(citationClipRange("12", "16", false), { start: null, end: null });
  assert.deepEqual(citationClipRange(12, 150, false), { start: 12, end: null });
});

test("adding two clips keeps the previously cited narration and their separate placement", () => {
  const script = "Try a different opening.\n\nSee what it changes.";
  const cue = sourceQuoteCue({ asset: "10000000-0000-4000-8000-000000000001", start: 5, end: 8, credit: "Original interview" });
  const withQuotes = `Try a different opening.\n\n[${cue}]\n\nSee what it changes.\n\n[${cue}]`;
  assert.ok(sameScriptNarration(script, withQuotes));
  assert.equal(sameScriptNarration(script, "A different line."), false);
  assert.deepEqual(parseScriptTimeline(withQuotes).quotes.map(quote => quote.beforeBeat), [2, 3]);
});


test("saving a proposal with single-newline cues preserves citations after the editor splits its beats", () => {
  const proposal = "[Opening]\nHere’s how I’d film my first intro.\n[Play take two.]\nHear the emphasis on first.";
  const saved = "[Opening]\n\n[Speaker: Host]\nHere’s how I’d film my first intro.\n\n[Play take two.]\n\nHear the emphasis on first.";
  assert.equal(parseScriptTimeline(proposal).beats.length, 1);
  assert.equal(parseScriptTimeline(saved).beats.length, 2);
  assert.ok(sameScriptNarration(proposal, saved));
  assert.equal(sameScriptNarration(proposal, saved.replace("emphasis", "pause")), false);
});
