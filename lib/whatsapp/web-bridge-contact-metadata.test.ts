import assert from "node:assert/strict";
import test from "node:test";
import { extractWhatsAppWebBridgeContactMetadata } from "./web-bridge-contact-metadata";

test("extracts the phone identity retained on an initial inbound sender model", () => {
    const identity = extractWhatsAppWebBridgeContactMetadata({
        fallbackJid: "160099217719497@lid",
        messageOrChat: {
            fromMe: false,
            _data: {
                senderObj: {
                    id: { _serialized: "160099217719497@lid" },
                    phoneNumber: { _serialized: "35799123456@c.us" },
                    pushname: "New lead",
                },
            },
        },
    });

    assert.equal(identity.lidJid, "160099217719497@lid");
    assert.equal(identity.phoneJid, "35799123456@c.us");
    assert.equal(identity.displayName, "New lead");
});

test("does not treat LID digits or the inbound recipient as the contact phone", () => {
    const identity = extractWhatsAppWebBridgeContactMetadata({
        fallbackJid: "160099217719497@lid",
        messageOrChat: {
            fromMe: false,
            _data: {
                to: { _serialized: "35794006663@c.us" },
                senderObj: {
                    id: { _serialized: "160099217719497@lid" },
                    number: "160099217719497",
                },
            },
        },
    });

    assert.equal(identity.lidJid, "160099217719497@lid");
    assert.equal(identity.phoneJid, "");
});

test("uses embedded identity added to a lightweight history record", () => {
    const identity = extractWhatsAppWebBridgeContactMetadata({
        fallbackJid: "160099217719497@lid",
        messageOrChat: {
            fromMe: true,
            _contactIdentity: {
                lidJid: "160099217719497@lid",
                phoneJid: "35799123456@s.whatsapp.net",
                displayName: "Known recipient",
            },
        },
    });

    assert.equal(identity.phoneJid, "35799123456@s.whatsapp.net");
    assert.equal(identity.displayName, "Known recipient");
});

test("preserves ordinary contact metadata when no embedded identity is present", () => {
    const identity = extractWhatsAppWebBridgeContactMetadata({
        fallbackJid: "35799123456@c.us",
        messageOrChat: { fromMe: false },
        contact: {
            id: { _serialized: "35799123456@c.us" },
            name: "Saved contact",
            number: "35799123456",
            isMyContact: true,
        },
    });

    assert.equal(identity.phoneJid, "35799123456@c.us");
    assert.equal(identity.name, "Saved contact");
    assert.equal(identity.number, "35799123456");
    assert.equal(identity.isMyContact, true);
});
