import assert from "node:assert/strict";
import test from "node:test";
import { ttsMaxTokens } from "./tts";

test("the on-device voice may not run past about twice natural pace, so a stuck run stops instead of filling memory", () => {
  assert.equal(ttsMaxTokens("Hello, this is how I will sound in your videos."), 160);   // 10 words: about 4 s of speech, allowed 12.8 s
  assert.equal(ttsMaxTokens("Hi."), 100);                                                // never below a short floor
  assert.ok(ttsMaxTokens("word ".repeat(2000)) <= 9000);                                // and never unbounded
});
