import assert from "node:assert/strict";
import test from "node:test";
import { activeWord, buildTranscript } from "./transcript";

test("words are spread across each beat's narration clip, with longer pauses after punctuation", () => {
  const lines = buildTranscript(["Stop scrolling, now.", "One two"], [{ s: 0, e: 4 }, { s: 4, e: 6 }])!;
  assert.equal(lines.length, 2);
  const [a, b] = lines;
  assert.equal(a.words.map(w => w.text).join(" "), "Stop scrolling, now.");
  assert.equal(a.words[0].start, 0); assert.ok(Math.abs(a.words.at(-1)!.end - 4) < 0.002);
  for (let i = 1; i < a.words.length; i++) assert.ok(Math.abs(a.words[i].start - a.words[i - 1].end) < 0.002, "no gaps or overlaps");
  // "scrolling," is long and carries a comma pause, so it takes more time than "Stop"
  assert.ok(a.words[1].end - a.words[1].start > a.words[0].end - a.words[0].start);
  assert.equal(b.start, 4); assert.equal(b.words.length, 2);
});

test("clips out of order are matched by time; a mismatch gives no transcript instead of a wrong one", () => {
  const lines = buildTranscript(["first", "second"], [{ s: 5, e: 8 }, { s: 0, e: 3 }])!;
  assert.equal(lines[0].start, 0); assert.equal(lines[1].start, 5);
  assert.equal(buildTranscript(["one", "two", "three"], [{ s: 0, e: 1 }, { s: 1, e: 2 }]), null);
  assert.equal(buildTranscript([], []), null);
  assert.equal(buildTranscript(["a"], [{ s: 2, e: 2 }]), null);
});

test("the active word follows the playhead and is empty between lines", () => {
  const lines = buildTranscript(["alpha beta gamma"], [{ s: 10, e: 13 }])!;
  assert.equal(activeWord(lines, 9.9), null);
  assert.deepEqual(activeWord(lines, 10), { line: 0, word: 0 });
  const mid = lines[0].words[1];
  assert.deepEqual(activeWord(lines, mid.start + 0.01), { line: 0, word: 1 });
  assert.deepEqual(activeWord(lines, 12.99), { line: 0, word: 2 });
  assert.equal(activeWord(lines, 13), null);
});

test("emoji, quotes and numbers do not break the weights", () => {
  const lines = buildTranscript(['He said "go!" 🚀 in 2026.'], [{ s: 0, e: 5 }])!;
  assert.equal(lines[0].words.length, 6);
  assert.ok(lines[0].words.every(w => w.end > w.start));
});

test("markdown emphasis marks are not shown as words", () => {
  const lines = buildTranscript(["**Does your first shot deliver?** Then `go`."], [{ s: 0, e: 5 }])!;
  assert.equal(lines[0].words.map(w => w.text).join(" "), "Does your first shot deliver? Then go.");
});
