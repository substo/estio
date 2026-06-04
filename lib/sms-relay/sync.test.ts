import test from "node:test";
import assert from "node:assert/strict";
import { processSmsRelayInbound } from "./sync";

function createFakeDb(seed?: {
    contacts?: any[];
    conversations?: any[];
    messages?: any[];
}) {
    const state = {
        locations: [{ id: "loc_1", ghlLocationId: null, ghlAccessToken: null }],
        contacts: [...(seed?.contacts || [])],
        conversations: [...(seed?.conversations || [])],
        messages: [...(seed?.messages || [])],
    };

    const db = {
        $queryRaw: async (_strings: TemplateStringsArray, locationId: string, digits: string, take: number) =>
            state.contacts
                .filter((contact) => {
                    const contactDigits = String(contact.phone || "").replace(/\D/g, "");
                    return contact.locationId === locationId && contactDigits === digits;
                })
                .slice(0, take),
        location: {
            findUnique: async ({ where }: any) =>
                state.locations.find((location) => location.id === where.id) || null,
        },
        contact: {
            findFirst: async ({ where }: any) =>
                state.contacts.find((contact) => {
                    const phoneContains = where.phone?.contains;
                    return contact.locationId === where.locationId
                        && (!phoneContains || String(contact.phone || "").includes(phoneContains));
                }) || null,
            findMany: async ({ where, take }: any) =>
                state.contacts
                    .filter((contact) => {
                        const clauses = Array.isArray(where.OR) ? where.OR : [{ phone: where.phone }];
                        return contact.locationId === where.locationId
                            && clauses.some((clause: any) => {
                                const phoneContains = clause.phone?.contains;
                                return !phoneContains || String(contact.phone || "").includes(phoneContains);
                            });
                    })
                    .slice(0, take || state.contacts.length),
            create: async ({ data }: any) => {
                const contact = { id: `contact_${state.contacts.length + 1}`, ...data };
                state.contacts.push(contact);
                return contact;
            },
        },
        conversation: {
            findUnique: async ({ where }: any) => {
                const key = where.locationId_contactId;
                return state.conversations.find((conversation) =>
                    conversation.locationId === key.locationId && conversation.contactId === key.contactId
                ) || null;
            },
            create: async ({ data }: any) => {
                const conversation = { id: `conv_${state.conversations.length + 1}`, ...data };
                state.conversations.push(conversation);
                return conversation;
            },
            update: async ({ where, data }: any) => {
                const conversation = state.conversations.find((item) => item.id === where.id);
                if (!conversation) throw new Error("conversation not found");
                const { unreadCount, ...scalarData } = data;
                Object.assign(conversation, scalarData);
                if (data.unreadCount?.increment) {
                    conversation.unreadCount = (conversation.unreadCount || 0) + data.unreadCount.increment;
                }
                return conversation;
            },
        },
        message: {
            findFirst: async ({ where }: any) =>
                state.messages.find((message) => message.clientMessageId === where.clientMessageId) || null,
            create: async ({ data }: any) => {
                const message = { id: `msg_${state.messages.length + 1}`, ...data };
                state.messages.push(message);
                return message;
            },
        },
    };

    return { db, state };
}

function basePayload(overrides?: Record<string, unknown>) {
    return {
        locationId: "loc_1",
        deviceId: "device_1",
        from: "+35799111222",
        to: "",
        body: "Hello from Android inbound",
        receivedAt: new Date("2026-05-08T08:00:00.000Z"),
        contactName: null,
        ...overrides,
    };
}

test("existing contact and conversation creates inbound TYPE_SMS message", async () => {
    const { db, state } = createFakeDb({
        contacts: [{ id: "contact_1", locationId: "loc_1", phone: "+35799111222", name: "Existing Lead" }],
        conversations: [{
            id: "conv_1",
            locationId: "loc_1",
            contactId: "contact_1",
            lastMessageType: "TYPE_SMS",
            unreadCount: 2,
        }],
    });

    const result = await processSmsRelayInbound(basePayload(), {
        db,
        publishConversationRealtimeEvent: async () => {},
    });

    assert.equal(result.status, "created");
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].type, "TYPE_SMS");
    assert.equal(state.messages[0].source, "sms_relay");
    assert.equal(state.messages[0].direction, "inbound");
    assert.equal(state.conversations[0].lastMessageType, "TYPE_SMS");
    assert.equal(state.conversations[0].unreadCount, 3);
});

test("unknown phone creates lead contact and conversation", async () => {
    const { db, state } = createFakeDb();

    const result = await processSmsRelayInbound(basePayload({ contactName: "New Sender" }), {
        db,
        publishConversationRealtimeEvent: async () => {},
    });

    assert.equal(result.status, "created");
    assert.equal(state.contacts.length, 1);
    assert.equal(state.contacts[0].name, "New Sender");
    assert.equal(state.contacts[0].leadSource, "SMS Relay");
    assert.equal(state.conversations.length, 1);
    assert.equal(state.conversations[0].lastMessageType, "TYPE_SMS");
    assert.equal(state.conversations[0].unreadCount, 1);
});

test("similar phone suffix does not hijack inbound SMS conversation", async () => {
    const { db, state } = createFakeDb({
        contacts: [{ id: "contact_1", locationId: "loc_1", phone: "+35700111222", name: "Similar Suffix" }],
        conversations: [{ id: "conv_1", locationId: "loc_1", contactId: "contact_1", unreadCount: 0 }],
    });

    const result = await processSmsRelayInbound(basePayload(), {
        db,
        publishConversationRealtimeEvent: async () => {},
    });

    assert.equal(result.status, "created");
    assert.equal(state.contacts.length, 2);
    assert.equal(state.contacts[1].phone, "+35799111222");
    assert.equal(state.conversations.length, 2);
    assert.equal(state.messages[0].conversationId, "conv_2");
});

test("duplicate inbound payload returns duplicate without creating another message", async () => {
    const { db, state } = createFakeDb({
        contacts: [{ id: "contact_1", locationId: "loc_1", phone: "+35799111222", name: "Existing Lead" }],
        conversations: [{ id: "conv_1", locationId: "loc_1", contactId: "contact_1", unreadCount: 0 }],
    });
    const deps = { db, publishConversationRealtimeEvent: async () => {} };

    const first = await processSmsRelayInbound(basePayload(), deps);
    const second = await processSmsRelayInbound(basePayload(), deps);

    assert.equal(first.status, "created");
    assert.equal(second.status, "duplicate");
    assert.equal(state.messages.length, 1);
    assert.equal(state.conversations[0].unreadCount, 1);
});
