import test from "node:test";
import assert from "node:assert/strict";

import {
    canStartContactConversation,
    resolveContactConversationStartMessageType,
} from "./conversation-start";

test("canStartContactConversation allows phone or email identities", () => {
    assert.equal(canStartContactConversation({ phone: "+35799000000", email: null }), true);
    assert.equal(canStartContactConversation({ phone: null, email: "lead@example.com" }), true);
    assert.equal(canStartContactConversation({ phone: null, email: null }), false);
    assert.equal(canStartContactConversation(null), false);
});

test("resolveContactConversationStartMessageType uses phone resolver before email fallback", async () => {
    const calls: string[] = [];
    const result = await resolveContactConversationStartMessageType(
        { phone: "+35799000000", email: "lead@example.com" },
        async (phone) => {
            calls.push(phone);
            return "TYPE_WHATSAPP";
        }
    );

    assert.equal(result, "TYPE_WHATSAPP");
    assert.deepEqual(calls, ["+35799000000"]);
});

test("resolveContactConversationStartMessageType creates email conversations for email-only contacts", async () => {
    const result = await resolveContactConversationStartMessageType(
        { phone: null, email: "lead@example.com" },
        async () => {
            throw new Error("phone resolver should not run for email-only contacts");
        }
    );

    assert.equal(result, "TYPE_EMAIL");
});

test("resolveContactConversationStartMessageType returns null when no phone or email exists", async () => {
    const result = await resolveContactConversationStartMessageType(
        { phone: null, email: null },
        async () => "TYPE_SMS"
    );

    assert.equal(result, null);
});
