import test from "node:test";
import assert from "node:assert/strict";
import {
    buildQueueJobId,
    isDuplicateQueueJobError,
    normalizeQueueJobIdSegment,
} from "./job-id.ts";

test("normalizeQueueJobIdSegment removes unsupported characters and colons", () => {
    assert.equal(normalizeQueueJobIdSegment(" location:abc/123 "), "location_abc_123");
});

test("buildQueueJobId is deterministic and contains no colon", () => {
    const idA = buildQueueJobId("outbox", "cmn5vqtw20009a4q4al7o3c65");
    const idB = buildQueueJobId("outbox", "cmn5vqtw20009a4q4al7o3c65");

    assert.equal(idA, idB);
    assert.equal(idA.includes(":"), false);
});

test("buildQueueJobId never returns integer-only IDs", () => {
    const jobId = buildQueueJobId("123");
    assert.equal(/^-?\d+$/.test(jobId), false);
    assert.equal(jobId.startsWith("j_"), true);
});

test("isDuplicateQueueJobError detects BullMQ duplicate messages", () => {
    assert.equal(isDuplicateQueueJobError(new Error("Job abc already exists")), true);
    assert.equal(isDuplicateQueueJobError(new Error("Custom Id cannot contain :")), false);
});
