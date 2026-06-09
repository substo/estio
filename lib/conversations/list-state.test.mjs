import test from "node:test";
import assert from "node:assert/strict";
import listState from "./list-state.ts";

const {
    appendConversationPageFromResponse,
    applyConversationDeltaPayload,
    deriveConversationListPageInfo,
    mergeConversationLists,
    mergeConversationListsWithIncomingFirst,
    normalizeFetchedConversations,
    replaceConversationListFromResponse,
} = listState;

function conversation(id, overrides = {}) {
    return {
        id,
        contactId: `contact-${id}`,
        contactName: `Contact ${id}`,
        lastMessageDate: 100,
        unreadCount: 0,
        ...overrides,
    };
}

test("mergeConversationLists dedupes with existing rows first", () => {
    const existing = [
        conversation("a", { contactName: "Existing A" }),
        conversation("b"),
    ];
    const incoming = [
        conversation("a", { contactName: "Incoming A" }),
        conversation("c"),
    ];

    assert.deepEqual(
        mergeConversationLists(existing, incoming).map((item) => [item.id, item.contactName]),
        [
            ["a", "Existing A"],
            ["b", "Contact b"],
            ["c", "Contact c"],
        ]
    );
});

test("mergeConversationListsWithIncomingFirst dedupes with incoming rows first", () => {
    const existing = [
        conversation("a", { contactName: "Existing A" }),
        conversation("b"),
    ];
    const incoming = [
        conversation("a", { contactName: "Incoming A" }),
        conversation("c"),
    ];

    assert.deepEqual(
        mergeConversationListsWithIncomingFirst(existing, incoming).map((item) => [item.id, item.contactName]),
        [
            ["a", "Incoming A"],
            ["c", "Contact c"],
            ["b", "Contact b"],
        ]
    );
});

test("response normalization preserves optimistic unread reset", () => {
    const normalized = normalizeFetchedConversations([
        conversation("a", { unreadCount: 3 }),
        conversation("b", { unreadCount: 2 }),
    ], new Set(["a"]));

    assert.equal(normalized[0].unreadCount, 0);
    assert.equal(normalized[1].unreadCount, 2);
});

test("replaceConversationListFromResponse returns normalized rows and page info", () => {
    const state = replaceConversationListFromResponse({
        conversations: [conversation("a", { unreadCount: 4 })],
        hasMore: true,
        nextCursor: "next-1",
        deltaCursor: "delta-1",
    }, new Set(["a"]));

    assert.equal(state.conversations[0].unreadCount, 0);
    assert.deepEqual(state.pageInfo, {
        hasMore: true,
        nextCursor: "next-1",
        deltaCursor: "delta-1",
    });
});

test("appendConversationPageFromResponse appends without duplicates and derives cursors", () => {
    const state = appendConversationPageFromResponse([
        conversation("a", { contactName: "Existing A" }),
        conversation("b"),
    ], {
        conversations: [
            conversation("a", { contactName: "Incoming A" }),
            conversation("c"),
        ],
        hasMore: false,
        nextCursor: null,
    }, new Set());

    assert.deepEqual(
        state.conversations.map((item) => [item.id, item.contactName]),
        [
            ["a", "Existing A"],
            ["b", "Contact b"],
            ["c", "Contact c"],
        ]
    );
    assert.deepEqual(state.pageInfo, { hasMore: false, nextCursor: null });
});

test("applyConversationDeltaPayload moves matching incoming conversations to top", () => {
    const state = applyConversationDeltaPayload([
        conversation("a", { contactName: "Old A" }),
        conversation("b"),
    ], {
        deltas: [
            {
                id: "a",
                matchesFilter: true,
                conversation: conversation("a", { contactName: "New A" }),
            },
        ],
        cursor: "delta-2",
    }, new Set());

    assert.deepEqual(
        state.conversations.map((item) => [item.id, item.contactName]),
        [
            ["a", "New A"],
            ["b", "Contact b"],
        ]
    );
    assert.equal(state.deltaCursor, "delta-2");
});

test("applyConversationDeltaPayload removes conversations that no longer match without clearing active state", () => {
    const state = applyConversationDeltaPayload([
        conversation("active"),
        conversation("b"),
    ], {
        deltas: [
            { id: "active", matchesFilter: false },
        ],
        cursor: null,
    }, new Set());

    assert.deepEqual(state.conversations.map((item) => item.id), ["b"]);
    assert.equal(state.deltaCursor, null);
});

test("applyConversationDeltaPayload preserves optimistic unread reset for stale deltas", () => {
    const state = applyConversationDeltaPayload([
        conversation("a", { unreadCount: 0 }),
    ], {
        deltas: [
            {
                id: "a",
                matchesFilter: true,
                conversation: conversation("a", { unreadCount: 5 }),
            },
        ],
    }, new Set(["a"]));

    assert.equal(state.conversations[0].unreadCount, 0);
});

test("applyConversationDeltaPayload preserves acknowledged unread reset for stale deltas", () => {
    const state = applyConversationDeltaPayload([
        conversation("a", { unreadCount: 0, lastMessageDate: 100 }),
    ], {
        deltas: [
            {
                id: "a",
                matchesFilter: true,
                conversation: conversation("a", { unreadCount: 5, lastMessageDate: 100 }),
            },
        ],
    }, new Map([["a", 100]]));

    assert.equal(state.conversations[0].unreadCount, 0);
});

test("applyConversationDeltaPayload allows unread count for messages newer than acknowledged reset", () => {
    const state = applyConversationDeltaPayload([
        conversation("a", { unreadCount: 0, lastMessageDate: 100 }),
    ], {
        deltas: [
            {
                id: "a",
                matchesFilter: true,
                conversation: conversation("a", { unreadCount: 1, lastMessageDate: 101 }),
            },
        ],
    }, new Map([["a", 100]]));

    assert.equal(state.conversations[0].unreadCount, 1);
});

test("deriveConversationListPageInfo only includes deltaCursor when response carries it", () => {
    assert.deepEqual(deriveConversationListPageInfo({
        hasMore: true,
        nextCursor: "next",
    }), {
        hasMore: true,
        nextCursor: "next",
    });

    assert.deepEqual(deriveConversationListPageInfo({
        hasMore: false,
        nextCursor: 123,
        deltaCursor: null,
    }), {
        hasMore: false,
        nextCursor: null,
        deltaCursor: null,
    });
});
