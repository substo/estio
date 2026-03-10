import test from "node:test";
import assert from "node:assert/strict";
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_INITIAL_MAX_MESSAGES,
    THREAD_INITIAL_MIN_MESSAGES,
    buildMessageCursorFromMessage,
    calculatePrependScrollTop,
    computeInitialMessageLimitFromViewport,
    mergePrependMessagesDedupe,
} from "./thread-hydration.ts";

test("computeInitialMessageLimitFromViewport falls back when viewport is missing", () => {
    assert.equal(computeInitialMessageLimitFromViewport(undefined), THREAD_INITIAL_FALLBACK_MESSAGES);
    assert.equal(computeInitialMessageLimitFromViewport(null), THREAD_INITIAL_FALLBACK_MESSAGES);
    assert.equal(computeInitialMessageLimitFromViewport(0), THREAD_INITIAL_FALLBACK_MESSAGES);
});

test("computeInitialMessageLimitFromViewport clamps to configured bounds", () => {
    assert.equal(computeInitialMessageLimitFromViewport(120), THREAD_INITIAL_MIN_MESSAGES);
    assert.equal(computeInitialMessageLimitFromViewport(10_000), THREAD_INITIAL_MAX_MESSAGES);
});

test("buildMessageCursorFromMessage returns timestamp and id", () => {
    const message = {
        id: "msg_1",
        dateAdded: "2026-03-10T10:00:00.000Z",
    };
    assert.equal(buildMessageCursorFromMessage(message), `${new Date(message.dateAdded).getTime()}::msg_1`);
    assert.equal(buildMessageCursorFromMessage({ id: "msg_2", dateAdded: "invalid" }), null);
});

test("mergePrependMessagesDedupe prepends only unseen ids", () => {
    const existing = [
        { id: "m2", dateAdded: "2026-03-10T10:02:00.000Z" },
        { id: "m3", dateAdded: "2026-03-10T10:03:00.000Z" },
    ];
    const older = [
        { id: "m1", dateAdded: "2026-03-10T10:01:00.000Z" },
        { id: "m2", dateAdded: "2026-03-10T10:02:00.000Z" },
    ];

    const merged = mergePrependMessagesDedupe(existing, older);
    assert.deepEqual(merged.map((message) => message.id), ["m1", "m2", "m3"]);
});

test("calculatePrependScrollTop keeps viewport anchor after prepend", () => {
    assert.equal(calculatePrependScrollTop(320, 1200, 1500), 620);
    assert.equal(calculatePrependScrollTop(0, 1200, 1200), 0);
});
