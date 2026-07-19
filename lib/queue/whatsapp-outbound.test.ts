import assert from "node:assert/strict";
import test from "node:test";
import { getOutboxQueueJobId } from "./whatsapp-outbound";

test("delayed retries do not collide with the active BullMQ job id", () => {
    const active = getOutboxQueueJobId("outbox-1");
    const retryA = getOutboxQueueJobId("outbox-1", "retry-a");
    const retryB = getOutboxQueueJobId("outbox-1", "retry-b");
    assert.notEqual(active, retryA);
    assert.notEqual(retryA, retryB);
});
