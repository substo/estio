import test from "node:test";
import assert from "node:assert/strict";
import {
    mergeConversationIntoTarget,
    previewConversationMergeEffects,
    type ConversationMergeEffects,
} from "./merge";

const SOURCE_CONVERSATION_ID = "source-conversation";
const TARGET_CONVERSATION_ID = "target-conversation";
const SOURCE_CONTACT_ID = "source-contact";
const TARGET_CONTACT_ID = "target-contact";

function createDelegate(options: {
    count?: number;
    findMany?: unknown[];
    updateManyCounts?: number[];
    findFirst?: unknown;
    findUnique?: unknown;
} = {}) {
    const calls = {
        count: [] as unknown[],
        findMany: [] as unknown[],
        findFirst: [] as unknown[],
        findUnique: [] as unknown[],
        update: [] as unknown[],
        updateMany: [] as unknown[],
        delete: [] as unknown[],
    };
    const updateManyCounts = [...(options.updateManyCounts || [])];

    return {
        calls,
        count: async (params: unknown) => {
            calls.count.push(params);
            return options.count || 0;
        },
        findMany: async (params: unknown) => {
            calls.findMany.push(params);
            return options.findMany || [];
        },
        findFirst: async (params: unknown) => {
            calls.findFirst.push(params);
            return options.findFirst || null;
        },
        findUnique: async (params: unknown) => {
            calls.findUnique.push(params);
            return options.findUnique || null;
        },
        update: async (params: unknown) => {
            calls.update.push(params);
            return {};
        },
        updateMany: async (params: unknown) => {
            calls.updateMany.push(params);
            return { count: updateManyCounts.length > 0 ? updateManyCounts.shift()! : options.count || 0 };
        },
        delete: async (params: unknown) => {
            calls.delete.push(params);
            return {};
        },
    };
}

function createMergeClient() {
    const client = {
        conversationParticipant: createDelegate(),
        conversationSync: createDelegate(),
        dealConversationLink: createDelegate(),
        message: createDelegate({ count: 3 }),
        messageSync: createDelegate({ count: 4 }),
        messageTranslationCache: createDelegate({ count: 5 }),
        providerOutbox: createDelegate({ count: 6 }),
        whatsAppOutboundOutbox: createDelegate({ count: 7 }),
        smsRelayOutbox: createDelegate({ count: 8 }),
        contactTask: createDelegate({ count: 9 }),
        insight: createDelegate({ count: 10 }),
        agentExecution: createDelegate({ count: 2, updateManyCounts: [1, 1] }),
        aiAutomationJob: createDelegate({ count: 3, updateManyCounts: [2, 1] }),
        aiDecision: createDelegate({ count: 4, updateManyCounts: [3, 1] }),
        aiSuggestedResponse: createDelegate({ count: 5, updateManyCounts: [4, 1] }),
        userNotification: createDelegate({ count: 6, updateManyCounts: [5, 1] }),
        conversation: createDelegate(),
    };

    return client as typeof client & Record<string, any>;
}

test("previewConversationMergeEffects reports AI and notification records as movable", async () => {
    const client = createMergeClient();

    const effects = await previewConversationMergeEffects({
        client: client as any,
        sourceConversationId: SOURCE_CONVERSATION_ID,
        targetConversationId: TARGET_CONVERSATION_ID,
    });

    assert.equal(effects.agentExecutions.moved, 2);
    assert.equal(effects.aiAutomationJobs.moved, 3);
    assert.equal(effects.aiDecisions.moved, 4);
    assert.equal(effects.aiSuggestedResponses.moved, 5);
    assert.equal(effects.userNotifications.moved, 6);
    assert.equal(effects.agentExecutions.detached, 0);
    assert.deepEqual(effects.warnings, []);
});

test("mergeConversationIntoTarget moves AI and notification records to the target conversation", async () => {
    const tx = createMergeClient();

    const effects = await mergeConversationIntoTarget({
        tx: tx as any,
        sourceConversationId: SOURCE_CONVERSATION_ID,
        targetConversationId: TARGET_CONVERSATION_ID,
        sourceContactId: SOURCE_CONTACT_ID,
        targetContactId: TARGET_CONTACT_ID,
    });

    assert.equal(effects.agentExecutions.moved, 2);
    assert.equal(effects.aiAutomationJobs.moved, 3);
    assert.equal(effects.aiDecisions.moved, 4);
    assert.equal(effects.aiSuggestedResponses.moved, 5);
    assert.equal(effects.userNotifications.moved, 6);

    assert.deepEqual(tx.agentExecution.calls.updateMany[0], {
        where: {
            conversationId: SOURCE_CONVERSATION_ID,
            sourceType: "conversation",
            sourceId: SOURCE_CONVERSATION_ID,
        },
        data: {
            conversationId: TARGET_CONVERSATION_ID,
            sourceId: TARGET_CONVERSATION_ID,
        },
    });
    assert.deepEqual(tx.agentExecution.calls.updateMany[1], {
        where: { conversationId: SOURCE_CONVERSATION_ID },
        data: { conversationId: TARGET_CONVERSATION_ID },
    });

    assert.deepEqual(tx.aiAutomationJob.calls.updateMany[0], {
        where: {
            conversationId: SOURCE_CONVERSATION_ID,
            contactId: SOURCE_CONTACT_ID,
        },
        data: {
            conversationId: TARGET_CONVERSATION_ID,
            contactId: TARGET_CONTACT_ID,
        },
    });
    assert.deepEqual(tx.aiAutomationJob.calls.updateMany[1], {
        where: { conversationId: SOURCE_CONVERSATION_ID },
        data: { conversationId: TARGET_CONVERSATION_ID },
    });
    assert.deepEqual(tx.aiDecision.calls.updateMany[0], tx.aiAutomationJob.calls.updateMany[0]);
    assert.deepEqual(tx.aiDecision.calls.updateMany[1], tx.aiAutomationJob.calls.updateMany[1]);
    assert.deepEqual(tx.aiSuggestedResponse.calls.updateMany[0], tx.aiAutomationJob.calls.updateMany[0]);
    assert.deepEqual(tx.userNotification.calls.updateMany[0], tx.aiAutomationJob.calls.updateMany[0]);
});

test("merge effects keep detached counts at zero when records move cleanly", async () => {
    const tx = createMergeClient();

    const effects: ConversationMergeEffects = await mergeConversationIntoTarget({
        tx: tx as any,
        sourceConversationId: SOURCE_CONVERSATION_ID,
        targetConversationId: TARGET_CONVERSATION_ID,
        sourceContactId: SOURCE_CONTACT_ID,
        targetContactId: TARGET_CONTACT_ID,
    });

    assert.equal(effects.agentExecutions.detached, 0);
    assert.equal(effects.aiAutomationJobs.detached, 0);
    assert.equal(effects.aiDecisions.detached, 0);
    assert.equal(effects.aiSuggestedResponses.detached, 0);
    assert.equal(effects.userNotifications.detached, 0);
});
