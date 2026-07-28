import assert from "node:assert/strict";
import test from "node:test";

import type { Conversation } from "@/lib/ghl/conversations";
import { filterLoadedConversations } from "./conversation-list-search";

function conversation(
    id: string,
    contactName: string,
    contactPhone: string,
    contactEmail = "",
): Conversation {
    return {
        id,
        contactId: `contact-${id}`,
        locationId: "location-1",
        lastMessageBody: "",
        lastMessageDate: 0,
        unreadCount: 0,
        status: "open",
        type: "TYPE_WHATSAPP",
        contactName,
        contactPhone,
        contactEmail,
    };
}

const conversations = [
    conversation("1", "María Green", "+357 99 123456", "maria@example.com"),
    conversation("2", "Martin Brown", "+44 7700 900123", "martin@example.com"),
];

test("filters loaded contacts immediately by accent-insensitive name tokens", () => {
    assert.deepEqual(
        filterLoadedConversations(conversations, "maria gre").map(({ id }) => id),
        ["1"],
    );
});

test("filters loaded contacts by normalized phone digits", () => {
    assert.deepEqual(
        filterLoadedConversations(conversations, "991234").map(({ id }) => id),
        ["1"],
    );
});

test("filters loaded contacts by email and preserves the original order", () => {
    assert.deepEqual(
        filterLoadedConversations(conversations, "example.com").map(({ id }) => id),
        ["1", "2"],
    );
});
