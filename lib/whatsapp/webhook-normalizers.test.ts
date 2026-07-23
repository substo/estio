import test from "node:test";
import assert from "node:assert/strict";
import {
    getWhatsAppCloudInboundBody,
    normalizeWhatsAppCloudInboundMessage,
    normalizeWhatsAppCloudInboundType,
    normalizeWhatsAppWebBridgeAckStatus,
    normalizeWhatsAppWebBridgeMessage,
    parseWhatsAppWebhookTimestamp,
} from "@/lib/whatsapp/webhook-normalizers";
import {
    hasWebBridgeIdentityNameConflict,
    getInitialWhatsAppSyncedMessageStatus,
    getOutboundWebBridgeManualRetryMatch,
    normalizeOutboundWebBridgeRetryBodyForMatch,
    selectPreferredWhatsAppLidContact,
    shouldRejectWebBridgeOutboundLidForOwnContact,
    shouldRejectWebBridgeResolvedPhoneAsOwnPhone,
} from "@/lib/whatsapp/sync";
import { extractReliableWebBridgePhone, getHighConfidenceWebBridgeResolvedPhone } from "@/lib/whatsapp/web-bridge-identity";
import { getWebBridgeDuplicateBodyReconciliation } from "@/lib/whatsapp/web-bridge-message-reconciliation";

test("getWhatsAppCloudInboundBody preserves provider-specific fallbacks", () => {
    assert.equal(getWhatsAppCloudInboundBody({ type: "text", text: { body: "hello" } }), "hello");
    assert.equal(getWhatsAppCloudInboundBody({ type: "image", image: {} }), "[Image]");
    assert.equal(getWhatsAppCloudInboundBody({ type: "document", document: { filename: "lease.pdf" } }), "lease.pdf");
    assert.equal(getWhatsAppCloudInboundBody({ type: "interactive", interactive: { list_reply: { title: "Yes" } } }), "Yes");
    assert.equal(getWhatsAppCloudInboundBody({ type: "contacts" }), "[Contact]");
    assert.equal(getWhatsAppCloudInboundBody({ type: "custom" }), "[custom]");
});

test("normalizeWhatsAppCloudInboundType keeps existing vocabulary", () => {
    assert.equal(normalizeWhatsAppCloudInboundType("text"), "text");
    assert.equal(normalizeWhatsAppCloudInboundType("chat"), "text");
    assert.equal(normalizeWhatsAppCloudInboundType("contacts"), "contact");
    assert.equal(normalizeWhatsAppCloudInboundType("button"), "other");
});

test("parseWhatsAppWebhookTimestamp handles seconds and fallback dates", () => {
    assert.equal(parseWhatsAppWebhookTimestamp("1710000000").toISOString(), "2024-03-09T16:00:00.000Z");
    assert.ok(parseWhatsAppWebhookTimestamp(undefined) instanceof Date);
});

test("normalizeWhatsAppCloudInboundMessage builds a sync message", () => {
    const normalized = normalizeWhatsAppCloudInboundMessage({
        locationId: "loc_1",
        phoneNumberId: "12345",
        contacts: [{ wa_id: "357999", profile: { name: "Ana" } }],
        message: {
            from: "357999",
            id: "wam_1",
            type: "text",
            text: { body: "Hi" },
            timestamp: "1710000000",
        },
    });

    assert.equal(normalized?.locationId, "loc_1");
    assert.equal(normalized?.from, "357999");
    assert.equal(normalized?.to, "12345");
    assert.equal(normalized?.type, "text");
    assert.equal(normalized?.body, "Hi");
    assert.equal(normalized?.wamId, "wam_1");
    assert.equal(normalized?.contactName, "Ana");
    assert.equal(normalized?.source, "whatsapp_native");
    assert.equal(normalized?.direction, "inbound");
});

test("normalizeWhatsAppWebBridgeAckStatus maps bridge ack values", () => {
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(3), "READ");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(2), "DELIVERED");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(1), "SERVER_ACK");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(-1), "FAILED");
    assert.equal(normalizeWhatsAppWebBridgeAckStatus(0), "");
});

test("normalizeOutboundWebBridgeRetryBodyForMatch preserves content while normalizing whitespace", () => {
    assert.equal(
        normalizeOutboundWebBridgeRetryBodyForMatch("Hello   there\r\n\r\n\r\nhttps://example.com/listing"),
        "Hello there\n\nhttps://example.com/listing"
    );
    assert.notEqual(
        normalizeOutboundWebBridgeRetryBodyForMatch("Hello there 1"),
        normalizeOutboundWebBridgeRetryBodyForMatch("Hello there 2")
    );
});

test("outbound Web Bridge retry matching uses the latest durable outbox activity", () => {
    const timestamp = new Date("2026-07-22T09:34:34.000Z");
    const match = getOutboundWebBridgeManualRetryMatch({
        createdAt: new Date("2026-07-22T06:42:17.841Z"),
        body: "Retry this message",
        outboundWhatsAppOutbox: {
            scheduledAt: new Date("2026-07-22T09:34:31.385Z"),
            updatedAt: new Date("2026-07-22T09:34:33.200Z"),
            status: "processing",
        },
    }, {
        timestamp,
        body: "Retry this message",
    });

    assert.equal(match.matches, true);
    assert.equal(match.bodyMatches, true);
    assert.equal(match.diffMs, 800);
});

test("an old provider event still matches the original logical message after later retry activity", () => {
    const match = getOutboundWebBridgeManualRetryMatch({
        createdAt: new Date("2026-07-22T06:42:17.841Z"),
        body: "Same body",
        outboundWhatsAppOutbox: {
            scheduledAt: new Date("2026-07-22T09:34:31.385Z"),
            updatedAt: new Date("2026-07-22T12:00:00.000Z"),
            status: "delivery_unconfirmed",
        },
    }, {
        timestamp: new Date("2026-07-22T06:42:18.000Z"),
        body: "Same body",
    });

    assert.equal(match.matches, true);
    assert.equal(match.diffMs, 159);
});

test("future outbox activity cannot make an unrelated old provider event match", () => {
    const match = getOutboundWebBridgeManualRetryMatch({
        createdAt: new Date("2026-07-22T00:00:00.000Z"),
        body: "Same body",
        outboundWhatsAppOutbox: {
            scheduledAt: new Date("2026-07-22T09:34:31.385Z"),
            updatedAt: new Date("2026-07-22T12:00:00.000Z"),
            status: "delivery_unconfirmed",
        },
    }, {
        timestamp: new Date("2026-07-22T06:42:18.000Z"),
        body: "Same body",
    });

    assert.equal(match.matches, false);
});

test("outbound Web Bridge ingestion waits for a real acknowledgement before showing sent", () => {
    assert.equal(getInitialWhatsAppSyncedMessageStatus({
        direction: "outbound",
        source: "whatsapp_web_bridge",
    }), "dispatch_accepted");
    assert.equal(getInitialWhatsAppSyncedMessageStatus({
        direction: "outbound",
        source: "whatsapp_native",
    }), "sent");
    assert.equal(getInitialWhatsAppSyncedMessageStatus({
        direction: "inbound",
        source: "whatsapp_web_bridge",
    }), "received");
});

test("selectPreferredWhatsAppLidContact prefers mapped phone contact over LID placeholder", () => {
    const placeholder = {
        id: "placeholder",
        name: "WhatsApp Contact",
        phone: null,
        contactType: "Lead",
    };
    const reconciled = {
        id: "real",
        name: "Moshe",
        phone: "+972526145279",
        contactType: "Lead",
    };

    assert.equal(
        selectPreferredWhatsAppLidContact([placeholder, reconciled], { mappedContactId: "real" })?.id,
        "real"
    );
});

test("selectPreferredWhatsAppLidContact prefers phone contact for outbound duplicate LID matches without a map", () => {
    assert.equal(
        selectPreferredWhatsAppLidContact([
            { id: "placeholder", phone: null, contactType: "Lead" },
            { id: "real", phone: "+972526145279", contactType: "Lead" },
        ])?.id,
        "real"
    );
});

test("hasWebBridgeIdentityNameConflict blocks LID metadata from another named contact", () => {
    assert.equal(
        hasWebBridgeIdentityNameConflict({
            source: "whatsapp_web_bridge",
            identity: {
                displayName: "Abdul Tareel",
                rawContactIdentity: {
                    displayName: "Abdul Tareel",
                    phoneJid: "35796926123@c.us",
                    lidJid: "256310847225967@lid",
                },
            },
            contact: {
                id: "dimitra",
                name: "Dimitra Lead Sale 2Bdr Apt Geroskipou",
                firstName: "Dimitra",
                lastName: "Tareel",
                email: "dimitrastam1@gmail.com",
                phone: "+35796926123",
                contactType: "Lead",
            },
        }),
        true
    );
});

test("hasWebBridgeIdentityNameConflict allows matching established contact names", () => {
    assert.equal(
        hasWebBridgeIdentityNameConflict({
            source: "whatsapp_web_bridge",
            identity: {
                displayName: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
            },
            contact: {
                id: "nicolas",
                name: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
                firstName: "Nicolas",
                phone: "+353870972075",
                contactType: "Lead",
            },
        }),
        false
    );
});

test("hasWebBridgeIdentityNameConflict trusts stable phone and LID match over stale bridge display name", () => {
    assert.equal(
        hasWebBridgeIdentityNameConflict({
            source: "whatsapp_web_bridge",
            identity: {
                phone: "35794089579",
                lid: "119456260952134@lid",
                displayName: "Martin Jarzyna - Down Town Cyprus - Real Estate Sales and Rentals",
                rawContactIdentity: {
                    displayName: "Martin Jarzyna - Down Town Cyprus - Real Estate Sales and Rentals",
                    phoneJid: "35794006663@c.us",
                    lidJid: "119456260952134@lid",
                },
            },
            contact: {
                id: "vladimir",
                name: "Vladimir Zoranovic Lead Sale DT2937 2Bdr Town House Peyia",
                firstName: "Vladimir",
                lastName: "Zoranovic",
                email: "zoranovicprivate@gmail.com",
                phone: "+35794089579",
                lid: "119456260952134@lid",
                contactType: "Lead",
            },
        }),
        false
    );
});

test("getWebBridgeDuplicateBodyReconciliation only repairs non-empty Web Bridge body changes", () => {
    assert.deepEqual(
        getWebBridgeDuplicateBodyReconciliation({
            source: "whatsapp_web_bridge",
            existingBody: "The heating underfloorbisbonlynin the 2 Showers",
            incomingBody: "The heating under floor is only in the 2 Showers",
        }),
        {
            shouldUpdate: true,
            body: "The heating under floor is only in the 2 Showers",
        }
    );

    assert.equal(getWebBridgeDuplicateBodyReconciliation({
        source: "whatsapp_web_bridge",
        existingBody: "Already correct",
        incomingBody: "Already correct",
    }).shouldUpdate, false);

    assert.equal(getWebBridgeDuplicateBodyReconciliation({
        source: "whatsapp_web_bridge",
        existingBody: "Keep this",
        incomingBody: "   ",
    }).shouldUpdate, false);

    assert.equal(getWebBridgeDuplicateBodyReconciliation({
        source: "whatsapp_native",
        existingBody: "Keep native body",
        incomingBody: "Different native body",
    }).shouldUpdate, false);
});

test("normalizeWhatsAppWebBridgeMessage preserves Web Bridge normalized fields", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: false,
            from: "35799111111@c.us",
            to: "35725000000@c.us",
            id: "wam_web_1",
            body: "Hello",
            type: "chat",
            timestamp: 1710000000,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.wamId, "wam_web_1");
    assert.equal(result.normalized?.from, "35799111111");
    assert.equal(result.normalized?.to, "35725000000");
    assert.equal(result.normalized?.type, "text");
    assert.equal(result.normalized?.body, "Hello");
    assert.equal(result.normalized?.direction, "inbound");
    assert.equal(result.normalized?.source, "whatsapp_web_bridge");
    assert.equal(result.normalized?.contactName, "Mia");
    assert.equal(result.normalized?.remoteJid, "35799111111@c.us");
    assert.equal(result.normalized?.chatId, "35799111111@c.us");
});

test("normalizeWhatsAppWebBridgeMessage ignores empty inbound chat without media", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: false,
            from: "35799111111@c.us",
            to: "35725000000@c.us",
            id: "wam_empty_1",
            body: "",
            type: "chat",
            timestamp: 1710000000,
            hasMedia: false,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.normalized, null);
    assert.equal(result.ignoreReason, "empty_inbound_text");
});

test("normalizeWhatsAppWebBridgeMessage renders inbound Web Bridge call events", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: false,
            from: "35799111111@c.us",
            to: "35725000000@c.us",
            id: "wam_call_1",
            body: "",
            type: "call_log",
            callStatus: "missed",
            timestamp: 1710000000,
            hasMedia: false,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.normalized?.type, "other");
    assert.equal(result.normalized?.body, "Missed voice call");
});

test("normalizeWhatsAppWebBridgeMessage renders outbound video call events", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: true,
            from: "35725000000@c.us",
            to: "35799111111@c.us",
            id: "wam_call_2",
            body: "",
            type: "call",
            isVideo: true,
            timestamp: 1710000000,
            hasMedia: false,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.normalized?.type, "other");
    assert.equal(result.normalized?.body, "Outgoing video call");
});

test("normalizeWhatsAppWebBridgeMessage keeps media-only inbound messages renderable", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: false,
            from: "35799111111@c.us",
            to: "35725000000@c.us",
            id: "wam_media_1",
            body: "",
            type: "image",
            timestamp: 1710000000,
            hasMedia: true,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.normalized?.type, "image");
    assert.equal(result.normalized?.body, "[Image]");
});

test("normalizeWhatsAppWebBridgeMessage never exposes an opaque image payload as message text", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35725000000@c.us",
        resolvedIdentity: { phone: "35799111111", displayName: "Mia" },
        message: {
            fromMe: true,
            from: "35725000000@c.us",
            to: "35799111111@c.us",
            id: "wam_media_opaque_1",
            body: `/9j/${"A".repeat(512)}`,
            type: "image",
            timestamp: 1710000000,
            hasMedia: true,
            contactIdentity: { source: "worker" },
        },
    });

    assert.equal(result.normalized?.type, "image");
    assert.equal(result.normalized?.body, "[Image]");
});

test("normalizeWhatsAppWebBridgeMessage uses resolved inbound LID phone instead of connected account phone", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "353870972075",
            lid: "160099217719497@lid",
            displayName: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
            source: "web_bridge_contact_metadata",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_AC4BE1E8A90672975B9563D2721AC3AE",
            body: "Hi Martin! Thanks for your message",
            type: "chat",
            timestamp: 1779972548,
            contactIdentity: {
                rawChatId: "160099217719497@lid",
                remoteJid: "160099217719497@lid",
                lidJid: "160099217719497@lid",
                phoneJid: "353870972075@c.us",
                displayName: "Nicolas White Lead Sale DT4771 Studio Kato Paphos",
            },
        },
    });

    assert.equal(result.normalized?.from, "353870972075");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, "353870972075");
    assert.equal(result.normalized?.lid, "160099217719497@lid");
    assert.equal(result.normalized?.contactName, "Nicolas White Lead Sale DT4771 Studio Kato Paphos");
});

test("normalizeWhatsAppWebBridgeMessage does not trust stale identity-map phone for inbound LID-only messages", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35794006663",
            lid: "160099217719497@lid",
            displayName: "Stale Martin Mapping",
            source: "identity_map",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_A2",
            body: "Inbound LID only",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "160099217719497@lid");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, undefined);
    assert.equal(result.normalized?.lid, "160099217719497@lid");
});

test("normalizeWhatsAppWebBridgeMessage trusts non-own identity-map phone for inbound LID-only messages", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35799123456",
            lid: "160099217719497@lid",
            displayName: "New WhatsApp Contact",
            source: "identity_map",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_A4",
            body: "Inbound after outbound",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "35799123456");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, "35799123456");
    assert.equal(result.normalized?.lid, "160099217719497@lid");
    assert.equal(result.normalized?.contactName, "New WhatsApp Contact");
});

test("normalizeWhatsAppWebBridgeMessage rejects connected account phone as inbound contact identity", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35794006663",
            lid: "160099217719497@lid",
            displayName: "Business Account",
            source: "web_bridge_contact_metadata",
        },
        message: {
            fromMe: false,
            from: "160099217719497@lid",
            to: "35794006663@c.us",
            id: "false_160099217719497@lid_A3",
            body: "Inbound reports business phone",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "160099217719497@lid");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.resolvedPhone, undefined);
});

test("normalizeWhatsAppWebBridgeMessage uses participant identity for inbound group messages", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: { phone: "353870972075", displayName: "Nick" },
        message: {
            fromMe: false,
            from: "120363310624402447@g.us",
            to: "35794006663@c.us",
            participant: "353870972075@s.whatsapp.net",
            id: "false_120363310624402447@g.us_A1_353870972075@s.whatsapp.net",
            body: "Group reply",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.from, "353870972075");
    assert.equal(result.normalized?.to, "35794006663");
    assert.equal(result.normalized?.isGroup, true);
    assert.equal(result.normalized?.remoteJid, "120363310624402447@g.us");
    assert.equal(result.normalized?.chatId, "120363310624402447@g.us");
    assert.equal(result.normalized?.participantJid, "353870972075@s.whatsapp.net");
    assert.equal(result.normalized?.participantPhoneJid, "353870972075@s.whatsapp.net");
});

test("normalizeWhatsAppWebBridgeMessage keeps outbound contact as recipient, not connected account", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: { phone: "353870972075", displayName: "Nicolas" },
        message: {
            fromMe: true,
            from: "35794006663@c.us",
            to: "353870972075@c.us",
            id: "true_353870972075@c.us_A1",
            body: "Outbound hello",
            type: "chat",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.direction, "outbound");
    assert.equal(result.normalized?.from, "35794006663");
    assert.equal(result.normalized?.to, "353870972075");
    assert.equal(result.normalized?.resolvedPhone, "353870972075");
    assert.notEqual(result.normalized?.to, "35794006663");
});

test("normalizeWhatsAppWebBridgeMessage rejects connected account phone for outbound LID media", () => {
    const result = normalizeWhatsAppWebBridgeMessage({
        locationId: "loc_1",
        phone: "35794006663@c.us",
        resolvedIdentity: {
            phone: "35794006663",
            lid: "79259527848167@lid",
            source: "web_bridge_contact_metadata",
        },
        message: {
            fromMe: true,
            from: "35794006663@c.us",
            to: "79259527848167@lid",
            id: "true_79259527848167@lid_A1",
            body: "",
            caption: "Photo",
            type: "image",
            timestamp: 1779972548,
        },
    });

    assert.equal(result.normalized?.direction, "outbound");
    assert.equal(result.normalized?.from, "35794006663");
    assert.equal(result.normalized?.to, "79259527848167@lid");
    assert.equal(result.normalized?.resolvedPhone, undefined);
    assert.equal(result.normalized?.lid, "79259527848167@lid");
    assert.notEqual(result.normalized?.to, "35794006663");
});

test("shouldRejectWebBridgeResolvedPhoneAsOwnPhone protects outbound sync routing", () => {
    assert.equal(shouldRejectWebBridgeResolvedPhoneAsOwnPhone({
        source: "whatsapp_web_bridge",
        direction: "outbound",
        resolvedPhone: "35794006663",
        ownPhone: "+35794006663",
        locationPhone: "35794006663@c.us",
    }), true);

    assert.equal(shouldRejectWebBridgeResolvedPhoneAsOwnPhone({
        source: "whatsapp_web_bridge",
        direction: "outbound",
        resolvedPhone: "353870972075",
        ownPhone: "+35794006663",
        locationPhone: "35794006663@c.us",
    }), false);

    assert.equal(shouldRejectWebBridgeResolvedPhoneAsOwnPhone({
        source: "whatsapp_web_bridge",
        direction: "inbound",
        resolvedPhone: "35794006663",
        ownPhone: "+35794006663",
    }), false);
});

test("shouldRejectWebBridgeOutboundLidForOwnContact protects against own-contact LID pollution", () => {
    assert.equal(shouldRejectWebBridgeOutboundLidForOwnContact({
        source: "whatsapp_web_bridge",
        direction: "outbound",
        messageLid: "132882144174113@lid",
        contactPhone: "+35794006663",
        ownPhone: "35794006663",
    }), true);

    assert.equal(shouldRejectWebBridgeOutboundLidForOwnContact({
        source: "whatsapp_web_bridge",
        direction: "outbound",
        messageLid: "132882144174113@lid",
        contactPhone: "+35799442455",
        ownPhone: "35794006663",
    }), false);

    assert.equal(shouldRejectWebBridgeOutboundLidForOwnContact({
        source: "whatsapp_web_bridge",
        direction: "inbound",
        messageLid: "132882144174113@lid",
        contactPhone: "+35794006663",
        ownPhone: "35794006663",
    }), false);
});

test("extractReliableWebBridgePhone prefers phone JID and rejects LID number digits", () => {
    const identity = {
        lidJid: "258699151036638@lid",
        number: "258699151036638",
        phoneJid: "35794475454@c.us",
    };

    assert.equal(extractReliableWebBridgePhone(identity, "258699151036638@lid"), "35794475454");
});

test("getHighConfidenceWebBridgeResolvedPhone accepts mapped contact phones but rejects own phone", () => {
    assert.equal(getHighConfidenceWebBridgeResolvedPhone({ phone: "+357 99 123456", source: "identity_map" }, "35794006663"), "35799123456");
    assert.equal(getHighConfidenceWebBridgeResolvedPhone({ phone: "+357 94 006663", source: "identity_map" }, "35794006663"), "");
    assert.equal(getHighConfidenceWebBridgeResolvedPhone({ phone: "0907476", source: "contact_lid" }, "35794006663"), "");
});
