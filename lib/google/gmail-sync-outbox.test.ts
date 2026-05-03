import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGmailSyncOutboxIdempotencyKey } from "./gmail-sync-outbox";

test("buildGmailSyncOutboxIdempotencyKey scopes jobs by user and operation", () => {
    assert.equal(
        buildGmailSyncOutboxIdempotencyKey({
            userId: "user_123",
            operation: "sync_user_gmail",
        }),
        "gmail_sync:user_123:sync_user_gmail"
    );
});

test("gmail sync no longer performs direct GHL side effects", () => {
    const source = readFileSync(new URL("./gmail-sync.ts", import.meta.url), "utf8");

    assert.equal(source.includes("createInboundMessage"), false);
    assert.equal(source.includes("ensureRemoteContact"), false);
    assert.equal(source.includes("native-${Date.now()}"), false);
    assert.equal(source.includes("ghlConversationId: null"), true);
    assert.equal(source.includes("enqueueGhlMessageMirror"), true);
});
