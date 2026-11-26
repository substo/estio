import assert from "node:assert/strict";
import test from "node:test";
import { ttsMaxTokens } from "./tts";

test("the on-device voice may not run past about about 1.4 times natural pace, so a stuck run stops instead of filling memory", () => {
  assert.equal(ttsMaxTokens("Hi, this is how I sound in your videos."), 113);   // 9 words: about 3 s of speech, allowed 9 s
  assert.equal(ttsMaxTokens("Hi."), 100);                                                // never below a short floor
  assert.ok(ttsMaxTokens("word ".repeat(2000)) <= 9000);                                // and never unbounded
});
