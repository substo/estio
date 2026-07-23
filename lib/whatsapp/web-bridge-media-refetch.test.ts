import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveRefetchChatCandidates,
    selectWhatsAppWebBridgeMediaRefetchCandidate,
    shouldAutomaticallyRefetchWhatsAppWebBridgeMedia,
    shouldRetryTransientMediaRefetchIngest,
} from "./web-bridge-media-refetch";

test("automatic media refetch is immediate for live events and bounded for reconciliation", () => {
    const nowMs = Date.parse("2026-07-23T10:00:00.000Z");
    assert.equal(shouldAutomaticallyRefetchWhatsAppWebBridgeMedia({
        event: "message_create",
        timestamp: 1,
        nowMs,
    }), true);
    assert.equal(shouldAutomaticallyRefetchWhatsAppWebBridgeMedia({
        event: "message_reconcile",
        timestamp: (nowMs - 60_000) / 1000,
        nowMs,
    }), true);
    assert.equal(shouldAutomaticallyRefetchWhatsAppWebBridgeMedia({
        event: "message_reconcile",
        timestamp: (nowMs - 3 * 60 * 60 * 1000) / 1000,
        nowMs,
    }), false);
});

test("media refetch accepts local and serialized WhatsApp provider id aliases", () => {
    const localId = "3EB0ABC123";
    const serializedId = `true_35799123456@c.us_${localId}`;
    const candidate = { id: localId, type: "image" };
    assert.equal(
        selectWhatsAppWebBridgeMediaRefetchCandidate([candidate], serializedId),
        candidate,
    );
    assert.equal(
        selectWhatsAppWebBridgeMediaRefetchCandidate([{ id: "different" }], serializedId),
        null,
    );
});

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

test("recoverable bridge media fetch failure is retryable before final queue attempt", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: new Error("r"),
            queueAttempt: 1,
            queueMaxAttempts: 5,
        }),
        true,
    );
});

test("bridge not-ready media fetch failure is retryable before final queue attempt", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready."),
            queueAttempt: 1,
            queueMaxAttempts: 5,
        }),
        true,
    );
});

test("recoverable bridge media fetch failure is not retried after final queue attempt", () => {
    assert.equal(
        shouldRetryTransientMediaRefetchIngest({
            error: new Error("getAlternateUserWid - Invalid get call using deviceWid"),
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

test("resolveRefetchChatCandidates prefers stored bridge thread ids before contact guesses", () => {
    const candidates = resolveRefetchChatCandidates(
        {
            contact: {
                phone: "+35799172163",
                lid: "179654942060724@lid",
            },
            syncRecords: [
                {
                    providerConversationId: "179654942060724@lid",
                    providerThreadId: "conversation-thread@lid",
                },
            ],
        },
        {
            syncRecords: [
                {
                    providerThreadId: "message-thread@lid",
                },
            ],
        },
    );

    assert.deepEqual(candidates, [
        "message-thread@lid",
        "179654942060724@lid",
        "conversation-thread@lid",
        "35799172163@c.us",
    ]);
});
