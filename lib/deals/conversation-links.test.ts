import test from "node:test";
import assert from "node:assert/strict";
import { collectDealConversationReferences } from "./conversation-links";

test("collectDealConversationReferences prefers link rows while preserving legacy refs", () => {
    const refs = collectDealConversationReferences({
        conversationIds: ["legacy_1", "conv_internal_1", "legacy_1"],
        conversationLinks: [
            { conversationId: "conv_internal_1", legacyConversationRef: "legacy_1" },
            { conversationId: "conv_internal_2", legacyConversationRef: null },
        ],
    });

    assert.deepEqual(refs.linkedConversationIds, ["conv_internal_1", "conv_internal_2"]);
    assert.deepEqual(refs.legacyConversationRefs, ["legacy_1", "conv_internal_1"]);
    assert.deepEqual(refs.fallbackConversationRefs, ["conv_internal_1", "conv_internal_2"]);
    assert.deepEqual(refs.allRefs, ["conv_internal_1", "conv_internal_2", "legacy_1"]);
});

test("collectDealConversationReferences falls back to legacy array when links are absent", () => {
    const refs = collectDealConversationReferences({
        conversationIds: ["legacy_1", "legacy_2"],
        conversationLinks: [],
    });

    assert.deepEqual(refs.linkedConversationIds, []);
    assert.deepEqual(refs.legacyConversationRefs, ["legacy_1", "legacy_2"]);
    assert.deepEqual(refs.fallbackConversationRefs, ["legacy_1", "legacy_2"]);
    assert.deepEqual(refs.allRefs, ["legacy_1", "legacy_2"]);
});
