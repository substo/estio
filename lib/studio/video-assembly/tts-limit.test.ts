import assert from "node:assert/strict";
import test from "node:test";
import { ttsMaxTokens } from "./tts";

test("the on-device voice may not run past about about 1.4 times natural pace, so a stuck run stops instead of filling memory", () => {
  assert.equal(ttsMaxTokens("Hello, this is how I will sound in your videos."), 120);   // 10 words: about 4 s of speech, allowed 9.6 s
  assert.equal(ttsMaxTokens("Hi."), 100);                                                // never below a short floor
  assert.ok(ttsMaxTokens("word ".repeat(2000)) <= 9000);                                // and never unbounded
});
