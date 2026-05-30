import assert from "node:assert/strict";
import test from "node:test";

import { mapConversationRowToUi } from "./conversation-row-mapper";

const baseRow = {
    id: "conversation-internal",
    ghlConversationId: "A0DQbYpSxEPptPbNvX41",
    contactId: "contact-internal",
    contact: {
        ghlContactId: "contact-provider",
        name: "Ada Lovelace",
        phone: "+35799123456",
        email: "ada@example.com",
        preferredLang: "el",
    },
    replyLanguageOverride: null,
    detectedThreadLanguage: "fr",
    detectedThreadLanguageConfidence: "0.82",
    lastMessageBody: "Bonjour",
    lastMessageAt: "2026-05-26T10:00:00.000Z",
    unreadCount: 3,
    status: "active",
    lastMessageType: "TYPE_SMS",
    suggestedActions: [{ type: "reply" }],
};

test("mapConversationRowToUi preserves default reply language fallback", () => {
    const mapped = mapConversationRowToUi(
        { ...baseRow, contact: { ...baseRow.contact, preferredLang: null } },
        { ghlLocationId: "loc-ghl" },
    );

    assert.equal(mapped.locationDefaultReplyLanguage, "en");
    assert.equal(mapped.locationId, "loc-ghl");
});

test("mapConversationRowToUi keeps likely GHL ids as provider ids and rejects local aliases", () => {
    const ghlMapped = mapConversationRowToUi(baseRow, { id: "loc-internal" });
    const localMapped = mapConversationRowToUi(
        { ...baseRow, ghlConversationId: "wa_1777555318460_contact" },
        { id: "loc-internal" },
    );

    assert.equal(ghlMapped.legacyConversationId, "A0DQbYpSxEPptPbNvX41");
    assert.equal(ghlMapped.providerConversationId, "A0DQbYpSxEPptPbNvX41");
    assert.equal(ghlMapped.ghlConversationId, "A0DQbYpSxEPptPbNvX41");
    assert.equal(localMapped.legacyConversationId, "wa_1777555318460_contact");
    assert.equal(localMapped.providerConversationId, null);
    assert.equal(localMapped.ghlConversationId, null);
});

test("mapConversationRowToUi resolves active deal by internal id before legacy id", () => {
    const dealMap = new Map([
        ["conversation-internal", { id: "deal-internal", title: "Internal Deal" }],
        ["A0DQbYpSxEPptPbNvX41", { id: "deal-legacy", title: "Legacy Deal" }],
    ]);
    const internalMapped = mapConversationRowToUi(baseRow, { id: "loc-internal" }, dealMap);
    const legacyMapped = mapConversationRowToUi(
        { ...baseRow, id: "conversation-other" },
        { id: "loc-internal" },
        dealMap,
    );

    assert.equal(internalMapped.activeDealId, "deal-internal");
    assert.equal(internalMapped.activeDealTitle, "Internal Deal");
    assert.equal(legacyMapped.activeDealId, "deal-legacy");
    assert.equal(legacyMapped.activeDealTitle, "Legacy Deal");
});

test("mapConversationRowToUi converts finite detected confidence and nulls non-numeric values", () => {
    const numericMapped = mapConversationRowToUi(baseRow, { id: "loc-internal" });
    const nullMapped = mapConversationRowToUi(
        { ...baseRow, detectedThreadLanguageConfidence: "not-a-number" },
        { id: "loc-internal" },
    );

    assert.equal(numericMapped.detectedThreadLanguageConfidence, 0.82);
    assert.equal(nullMapped.detectedThreadLanguageConfidence, null);
});

test("mapConversationRowToUi includes latest message source metadata when available", () => {
    const latestMessageMap = new Map([
        ["conversation-internal", {
            id: "message-latest",
            conversationId: "conversation-internal",
            type: "TYPE_SMS",
            source: "sms_relay",
            direction: "outbound",
            createdAt: new Date("2026-05-26T10:01:00.000Z"),
        }],
    ]);

    const mapped = mapConversationRowToUi(baseRow, { id: "loc-internal" }, undefined, undefined, latestMessageMap);

    assert.equal(mapped.lastMessageId, "message-latest");
    assert.equal(mapped.lastMessageType, "TYPE_SMS");
    assert.equal(mapped.lastMessageSource, "sms_relay");
    assert.equal(mapped.lastMessageDirection, "outbound");
    assert.equal(mapped.lastMessageChannel, "SMS_RELAY");
});

test("mapConversationRowToUi ignores stale latest message metadata", () => {
    const latestMessageMap = new Map([
        ["conversation-internal", {
            id: "message-stale",
            conversationId: "conversation-internal",
            type: "TYPE_SMS",
            source: "sms_relay",
            direction: "inbound",
            createdAt: new Date("2026-05-26T09:00:00.000Z"),
        }],
    ]);

    const mapped = mapConversationRowToUi(
        { ...baseRow, lastMessageType: "TYPE_EMAIL", lastMessageAt: "2026-05-26T10:00:00.000Z" },
        { id: "loc-internal" },
        undefined,
        undefined,
        latestMessageMap,
    );

    assert.equal(mapped.lastMessageId, null);
    assert.equal(mapped.lastMessageType, "TYPE_EMAIL");
    assert.equal(mapped.lastMessageSource, null);
    assert.equal(mapped.lastMessageChannel, "Email");
});
