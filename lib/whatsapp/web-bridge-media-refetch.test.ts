import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryTransientMediaRefetchIngest } from "./web-bridge-media-refetch";

test("transient media ingest failure is retryable before final queue attempt", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
            queueAttempt: 1,
            queueMaxAttempts: 5,
        }),
        true,
    );
});

test("transient media ingest failure is not retried after final queue attempt", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
            queueAttempt: 5,
            queueMaxAttempts: 5,
        }),
        false,
    );
});

test("permanent media ingest failure is not retried by the refetch queue", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: new Error("AccessDenied"),
            queueAttempt: 1,
            queueMaxAttempts: 5,
        }),
        false,
    );
});
