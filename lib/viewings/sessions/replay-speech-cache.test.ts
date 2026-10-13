import test from "node:test";
import assert from "node:assert/strict";
import { getOrGenerateReplaySpeech } from "./replay-speech-cache";

test("simultaneous and repeated replay requests generate one billable clip", async () => {
    let calls = 0;
    const generate = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 10)); return Buffer.from("voice"); };
    const key = `test:${Date.now()}:${Math.random()}`;
    const [first, second] = await Promise.all([getOrGenerateReplaySpeech(key, generate), getOrGenerateReplaySpeech(key, generate)]);
    const third = await getOrGenerateReplaySpeech(key, generate);
    assert.equal(calls, 1);
    assert.deepEqual(first.audio, Buffer.from("voice"));
    assert.equal([first.generated, second.generated, third.generated].filter(Boolean).length, 1);
});
