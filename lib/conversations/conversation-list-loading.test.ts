import assert from "node:assert/strict";
import test from "node:test";

import {
    buildConversationDeltaCursorFromRows,
    buildConversationStatusWhere,
    buildRankedConversationHydrationWhere,
    decodeConversationCursor,
    decodeConversationDeltaCursor,
    doesConversationMatchStatus,
    encodeConversationCursor,
    encodeConversationDeltaCursor,
} from "./conversation-list-loading";
import { buildLatestMessageMetadataMap } from "./latest-message-metadata";

test("conversation cursors round trip and reject invalid payloads", () => {
    const listCursor = encodeConversationCursor({
        id: "conv_123",
        lastMessageAt: new Date("2026-05-26T10:15:00.000Z"),
    });
    assert.deepEqual(decodeConversationCursor(listCursor), {
        id: "conv_123",
        lastMessageAtMs: Date.parse("2026-05-26T10:15:00.000Z"),
    });
    assert.equal(decodeConversationCursor("not-base64-json"), null);

    const deltaCursor = encodeConversationDeltaCursor({
        id: "conv_456",
        updatedAtMs: Date.parse("2026-05-26T11:00:00.000Z"),
    });
    assert.deepEqual(decodeConversationDeltaCursor(deltaCursor), {
        id: "conv_456",
        updatedAtMs: Date.parse("2026-05-26T11:00:00.000Z"),
    });
    assert.equal(decodeConversationDeltaCursor(Buffer.from(JSON.stringify({ id: "x" })).toString("base64")), null);
});

test("buildConversationDeltaCursorFromRows picks latest updated row with id tie-break", () => {
    const cursor = buildConversationDeltaCursorFromRows([
        { id: "conv_b", updatedAt: new Date("2026-05-26T10:00:00.000Z") },
        { id: "conv_a", updatedAt: new Date("2026-05-26T10:00:00.000Z") },
        { id: "conv_c", updatedAt: new Date("2026-05-26T09:59:00.000Z") },
    ]);

    assert.deepEqual(decodeConversationDeltaCursor(cursor), {
        id: "conv_b",
        updatedAtMs: Date.parse("2026-05-26T10:00:00.000Z"),
    });
});

test("status helpers preserve list filter semantics", () => {
    assert.deepEqual(buildConversationStatusWhere("active", "loc_1"), {
        locationId: "loc_1",
        deletedAt: null,
        archivedAt: null,
    });
    assert.deepEqual(buildConversationStatusWhere("archived", "loc_1"), {
        locationId: "loc_1",
        deletedAt: null,
        archivedAt: { not: null },
    });
    assert.deepEqual(buildConversationStatusWhere("trash", "loc_1"), {
        locationId: "loc_1",
        deletedAt: { not: null },
    });
    assert.deepEqual(buildConversationStatusWhere("all", "loc_1"), {
        locationId: "loc_1",
    });

    const deletedAt = new Date("2026-05-26T12:00:00.000Z");
    const archivedAt = new Date("2026-05-26T12:30:00.000Z");

    assert.equal(doesConversationMatchStatus("active", { deletedAt: null, archivedAt: null }), true);
    assert.equal(doesConversationMatchStatus("active", { deletedAt: null, archivedAt }), false);
    assert.equal(doesConversationMatchStatus("archived", { deletedAt: null, archivedAt }), true);
    assert.equal(doesConversationMatchStatus("archived", { deletedAt, archivedAt }), false);
    assert.equal(doesConversationMatchStatus("trash", { deletedAt, archivedAt: null }), true);
    assert.equal(doesConversationMatchStatus("all", { deletedAt, archivedAt }), true);
    assert.equal(doesConversationMatchStatus("tasks", { deletedAt, archivedAt }), true);
});

test("ranked search hydration reapplies the active location boundary", () => {
    assert.deepEqual(buildRankedConversationHydrationWhere("location_a", ["conversation_a", "conversation_b"]), {
        locationId: "location_a",
        id: { in: ["conversation_a", "conversation_b"] },
    });
});

test("buildLatestMessageMetadataMap indexes latest message source by conversation id", () => {
    const map = buildLatestMessageMetadataMap([
        {
            id: "msg_1",
            conversationId: "conv_1",
            type: "TYPE_SMS",
            source: "sms_relay",
            direction: "inbound",
            createdAt: new Date("2026-05-26T12:00:00.000Z"),
        },
    ]);

    assert.equal(map.get("conv_1")?.source, "sms_relay");
    assert.equal(map.get("conv_1")?.type, "TYPE_SMS");
});
