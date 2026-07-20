import assert from "node:assert/strict";
import test from "node:test";
import { BoundedJtiReplayCache } from "./jti-replay-cache";

test("a JTI is accepted once per gateway process until it expires", () => {
    const cache = new BoundedJtiReplayCache(3);
    assert.equal(cache.consume("jti-a", 101, 100_000), true);
    assert.equal(cache.consume("jti-a", 101, 100_001), false);
    assert.equal(cache.consume("jti-a", 102, 101_000), true);
});

test("JTI replay state remains bounded and fails closed while full", () => {
    const cache = new BoundedJtiReplayCache(2);
    assert.equal(cache.consume("jti-a", 200, 100_000), true);
    assert.equal(cache.consume("jti-b", 200, 100_000), true);
    assert.equal(cache.consume("jti-c", 200, 100_000), false);
    assert.equal(cache.size, 2);
    assert.equal(cache.consume("jti-a", 200, 100_000), false);
    assert.equal(cache.size, 2);
});
