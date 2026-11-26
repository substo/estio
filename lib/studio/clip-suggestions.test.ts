import assert from "node:assert/strict";
import test from "node:test";
import { addSuggestedClip, defaultCredit, suggestClips, type ClipSource } from "./clip-suggestions";
import { blocksToScript, type ScriptBlock } from "./script-blocks";
import { readSourceQuoteCue, sourceQuoteCue } from "./script-source-quotes";

const UP = "11111111-1111-4111-8111-111111111111";
const n = (id: string, text: string): ScriptBlock => ({ id, type: "narration", text });
const blocks = [
  n("a", "Tested two openings for my first video, and the opening that started with the problem doubled watch time."),
  n("b", "Here is exactly what changed in the second take."),
  n("c", "Thanks for watching."),
];
const source: ClipSource = { uploadId: UP, name: "interview-final.mp4", segments: [
  { start: 0, end: 4, text: "Welcome back everybody to the channel." },
  { start: 4, end: 9, text: "We tested two openings for the first video." },
  { start: 9, end: 14, text: "The opening that started with the problem doubled our watch time." },
  { start: 40, end: 44, text: "Completely unrelated chatter about lunch and coffee." },
] };

test("a script line is matched to the moment that says the same specific things, with real times and its own words", () => {
  const found = suggestClips(blocks, [source]);
  assert.equal(found.length, 1);
  assert.equal(found[0].blockId, "a");
  assert.equal(found[0].uploadId, UP);
  assert.ok(found[0].start >= 3.5 && found[0].start <= 4 && found[0].end >= 14 && found[0].end <= 14.5, JSON.stringify(found[0]));
  assert.match(found[0].quote, /doubled our watch time/);   // an exact stretch of the transcript, never invented
  assert.equal(found[0].name, "interview-final.mp4");
});

test("lines with too little in common, no sources, or a clip right after them get nothing", () => {
  assert.deepEqual(suggestClips(blocks, []), []);
  assert.deepEqual(suggestClips([n("c", "Thanks for watching.")], [source]), []);
  const cue = sourceQuoteCue({ asset: UP, start: 4, end: 14, credit: "x" });
  const withClip: ScriptBlock[] = [blocks[0], { id: "q", type: "visual", text: cue }, blocks[1]];
  assert.deepEqual(suggestClips(withClip, [source]), []);   // already has a clip after it, and that moment is taken
});

test("no two suggestions share a moment, and clips stay short", () => {
  const twice = [n("a", blocks[0].text), n("a2", "We tested two openings and the problem opening doubled our watch time again.")];
  const found = suggestClips(twice, [source]);
  assert.equal(found.length, 1);
  for (const f of suggestClips(blocks, [{ ...source, segments: Array.from({ length: 40 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: "tested openings problem doubled watch time first video" })) }])) assert.ok(f.end - f.start <= 16);
});

test("approving a suggestion adds one source clip block right after the line, and bad picks are refused", () => {
  const next = addSuggestedClip(blocks, { blockId: "a", uploadId: UP, start: 3.7, end: 14.3, credit: defaultCredit("interview-final.mp4") });
  assert.ok(next);
  assert.equal(next.length, blocks.length + 1);
  assert.equal(next[0].id, "a");
  const quote = readSourceQuoteCue(next[1].text);
  assert.deepEqual(quote, { asset: UP, start: 3.7, end: 14.3, credit: "interview-final" });
  assert.match(blocksToScript(next), /\[Source clip: /);
  assert.equal(addSuggestedClip(blocks, { blockId: "nope", uploadId: UP, start: 1, end: 3, credit: "x" }), null);
  assert.equal(addSuggestedClip(blocks, { blockId: "a", uploadId: "not-an-id", start: 1, end: 3, credit: "x" }), null);
  assert.equal(addSuggestedClip(blocks, { blockId: "a", uploadId: UP, start: 5, end: 5.1, credit: "x" }), null);
  assert.equal(defaultCredit("a [b].mov"), "a b");
});

test("real speech-to-text timings: neighbouring lines each get their own moment, and a paraphrase still finds it", () => {
  const real: ClipSource = { uploadId: UP, name: "TEST-speaking-clip.mp4", segments: [
    { start: 0, end: 5.36, text: "I tested two openings for my first video and one of them doubled how long people watched." },
    { start: 5.36, end: 8.64, text: "The winner started with the problem, not my name." },
    { start: 8.64, end: 10.56, text: "Here is exactly what I changed." },
  ] };
  const script = [n("a", "I tested two openings for my first video, and one of them doubled how long people watched."), n("b", "The winner started with the problem, not my name."), n("c", "The old opening kept 12 percent of viewers to the end.")];
  const found = suggestClips(script, [real]);
  assert.deepEqual(found.map(f => f.blockId), ["a", "b"]);   // the third line is not said in the video
  assert.ok(found[0].end <= 5.7 && found[1].start >= 5);
  assert.equal(suggestClips([n("p", "The opening I led with the problem about my first video doubled watch time for people watching.")], [real]).length, 1);
});
