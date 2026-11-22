import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, lengthFit, MAX_SINGLE_SCRIPT_SECONDS, parseDurationRequest, scriptStats, targetWords } from "./script-length";

test("natural speech sets, revises and clears an approximate duration", () => {
  const sec = (text: string) => { const r = parseDurationRequest(text); return r?.kind === "set" ? r.seconds : r; };
  assert.equal(sec("Make it about 90 seconds"), 90);
  assert.equal(sec("a 3–4 minute video"), 210);
  assert.equal(sec("something like 3 to 4 minutes"), 210);
  assert.equal(sec("keep it to two minutes"), 120);
  assert.equal(sec("make it half a minute"), 30);
  assert.equal(sec("roughly 1.5 minutes please"), 90);
  assert.equal(sec("actually make it 10 minutes"), 600);
  assert.equal(sec("Make the opener sharper"), null);
  assert.equal(sec("I met him at 3 pm"), null);
  assert.equal(sec("make it 5 seconds"), null);                                   // below the supported minimum
  assert.deepEqual(parseDurationRequest("no length limit, any length is fine"), { kind: "clear" });
});

test("only spoken copy counts; cues are separate; fit never calls a mismatch a pass", () => {
  const stats = scriptStats("[Cold open, cut to desk]\nHello there, today we compare two openings.\n[TRANSITION: whip pan]\nPick the one that keeps you watching.");
  assert.equal(stats.spokenWords, 14);
  assert.ok(stats.cueWords >= 6);
  assert.equal(scriptStats("word ".repeat(225)).seconds, 90);
  assert.deepEqual(targetWords(90), { target: 225, min: 191, max: 259 });
  assert.equal(lengthFit(90, 95).state, "match");
  assert.deepEqual(lengthFit(90, 70), { state: "short", percent: 22, meaningful: false, beyondSupported: false });
  assert.equal(lengthFit(90, 40).meaningful, true);
  assert.equal(lengthFit(90, 200).state, "long");
  assert.equal(lengthFit(MAX_SINGLE_SCRIPT_SECONDS + 60, 300).beyondSupported, true);
  assert.equal(formatClock(90), "1:30");
  assert.equal(MAX_SINGLE_SCRIPT_SECONDS, 480);
});
