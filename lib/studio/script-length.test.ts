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

test("m:ss runtimes: requested in context, never source timestamps, clock times or ratios; the latest explicit request wins", () => {
  const sec = (text: string) => { const r = parseDurationRequest(text); return r?.kind === "set" ? r.seconds : r; };
  // Requests
  assert.equal(sec("give me a 1:30 revision"), 90);
  assert.equal(sec("after a 6-minute script, make the revision 1:30"), 90);
  assert.equal(sec("Actually make it 1:30"), 90);
  assert.equal(sec("No, I asked for 1:30, not 6 minutes"), 90);
  assert.equal(sec("bring it down to 2:15"), 135);
  assert.equal(sec("I want a 3:00 video"), 180);
  assert.equal(sec("a 1:30 cut please"), 90);
  assert.equal(sec("make it 6 minutes, actually 1:30"), 90);                          // the later correction wins
  assert.equal(sec("make it 1:30, no wait, 2 minutes"), 120);
  // Not requests: source timestamps, clock times, ratios, invalid seconds
  assert.equal(sec("what does he say at 1:30?"), null);
  assert.equal(sec("use the quote from 1:30 to 2:10 in the hook"), null);
  assert.equal(sec("around 1:30 he explains the promise"), null);
  assert.equal(sec("the part at 1:30 in the video is great"), null);
  assert.equal(sec("book the shoot at 3:30 pm"), null);
  assert.equal(sec("tomorrow at 10:30"), null);
  assert.equal(sec("use a 16:09 ratio"), null);
  assert.equal(sec("make it 1:75"), null);                                           // seconds must be 00-59
  assert.equal(sec("watch from 1:02:30"), null);                                      // h:mm:ss is a timestamp
  assert.equal(sec("make it 0:05"), null);                                            // below the supported minimum
  // Earlier formats and descriptive durations
  assert.equal(sec("after a 6-minute script, thanks"), 360);                          // a sole duration is still a request
  assert.equal(sec("the earlier 6 minute script was great, now do 90 seconds"), 90);
  assert.equal(sec("Make it about 90 seconds"), 90);
  assert.equal(sec("a 3–4 minute video"), 210);
});
