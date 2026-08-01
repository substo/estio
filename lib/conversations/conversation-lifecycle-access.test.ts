import assert from "node:assert/strict";
import test from "node:test";

import {
    buildConversationLifecycleTargetWhere,
    resolveConversationLifecycleTargets,
    type ConversationLifecycleTarget,
} from "./conversation-lifecycle-access";

const localTarget: ConversationLifecycleTarget = {
    id: "conv_local",
    contactId: "contact_local",
    ghlConversationId: "ghl_local",
    syncRecords: [{ providerConversationId: "provider_local", providerThreadId: "thread_local" }],
};

test("lifecycle target queries are scoped to the active location and requested state", () => {
    assert.deepEqual(buildConversationLifecycleTargetWhere("loc_1", ["conv_local"], "archived"), {
        locationId: "loc_1",
        deletedAt: null,
        archivedAt: { not: null },
        OR: [
            { id: { in: ["conv_local"] } },
            { ghlConversationId: { in: ["conv_local"] } },
            { syncRecords: { some: { providerConversationId: { in: ["conv_local"] } } } },
            { syncRecords: { some: { providerThreadId: { in: ["conv_local"] } } } },
        ],
    });
});

test("same-location aliases resolve to canonical lifecycle targets", async () => {
    const result = await resolveConversationLifecycleTargets({
        locationId: "loc_1",
        conversationRefs: ["conv_local", "thread_local"],
        state: "notDeleted",
        findMany: async ({ where }) => {
            assert.equal(where.locationId, "loc_1");
            return [localTarget];
        },
    });

    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.targets.map((target) => target.id), ["conv_local"]);
});

test("mixed or foreign lifecycle identifiers are rejected as one operation", async () => {
    const result = await resolveConversationLifecycleTargets({
        locationId: "loc_1",
        conversationRefs: ["conv_local", "conv_foreign"],
        state: "trashed",
        findMany: async () => [localTarget],
    });

    assert.deepEqual(result, {
        success: false,
        error: "One or more conversations are unavailable",
    });
});
