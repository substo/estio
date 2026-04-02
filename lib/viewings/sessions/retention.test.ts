import assert from "node:assert/strict";
import test from "node:test";
import {
    isViewingSessionConversationExpired,
    normalizeViewingSessionRetentionDays,
    resolveViewingSessionRetentionReferenceAt,
    shouldPreserveViewingSessionSummary,
} from "@/lib/viewings/sessions/retention";

test("retention day normalization respects configured bounds", () => {
    assert.equal(normalizeViewingSessionRetentionDays(undefined), 30);
    assert.equal(normalizeViewingSessionRetentionDays(7), 30);
    assert.equal(normalizeViewingSessionRetentionDays(90), 90);
    assert.equal(normalizeViewingSessionRetentionDays(9999), 3650);
});

test("retention reference prefers endedAt then startedAt then createdAt", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const startedAt = new Date("2026-01-02T00:00:00.000Z");
    const endedAt = new Date("2026-01-03T00:00:00.000Z");

    assert.equal(
        resolveViewingSessionRetentionReferenceAt({ createdAt, startedAt, endedAt }).toISOString(),
        endedAt.toISOString()
    );
    assert.equal(
        resolveViewingSessionRetentionReferenceAt({ createdAt, startedAt, endedAt: null }).toISOString(),
        startedAt.toISOString()
    );
    assert.equal(
        resolveViewingSessionRetentionReferenceAt({ createdAt, startedAt: null, endedAt: null }).toISOString(),
        createdAt.toISOString()
    );
});

test("expired detection and final summary preservation rules", () => {
    const now = new Date("2026-04-02T00:00:00.000Z");

    const expired = isViewingSessionConversationExpired(
        {
            appliedRetentionDays: 30,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            startedAt: null,
            endedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
        now
    );
    const fresh = isViewingSessionConversationExpired(
        {
            appliedRetentionDays: 90,
            createdAt: new Date("2026-03-15T00:00:00.000Z"),
            startedAt: null,
            endedAt: new Date("2026-03-20T00:00:00.000Z"),
        },
        now
    );

    assert.equal(expired, true);
    assert.equal(fresh, false);
    assert.equal(shouldPreserveViewingSessionSummary("final"), true);
    assert.equal(shouldPreserveViewingSessionSummary("draft"), false);
});
