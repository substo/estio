import test from "node:test";
import assert from "node:assert/strict";
import { getConversationTimelineClassName, getMessageBubbleTheme } from "./message-bubble-theme";

test("WhatsApp outbound theme uses green bubble styling without SMS blue", () => {
    const theme = getMessageBubbleTheme({
        isWhatsApp: true,
        isSMS: false,
        isEmail: false,
        isOutbound: true,
    });

    assert.equal(theme.channel, "whatsapp");
    assert.equal(theme.isWhatsApp, true);
    assert.match(theme.bubbleClassName, /dcf8c6|emerald|green/);
    assert.doesNotMatch(theme.bubbleClassName, /bg-blue-600/);
    assert.match(theme.linkClassName, /emerald/);
});

test("SMS outbound theme preserves blue iOS-style message styling", () => {
    const theme = getMessageBubbleTheme({
        isWhatsApp: false,
        isSMS: true,
        isEmail: false,
        isOutbound: true,
    });

    assert.equal(theme.channel, "sms");
    assert.equal(theme.isWhatsApp, false);
    assert.match(theme.bubbleClassName, /bg-blue-600/);
    assert.doesNotMatch(theme.bubbleClassName, /dcf8c6|emerald/);
});

test("email theme preserves the existing outbound message surface", () => {
    const theme = getMessageBubbleTheme({
        isWhatsApp: false,
        isSMS: false,
        isEmail: true,
        isOutbound: true,
    });

    assert.equal(theme.channel, "email");
    assert.equal(theme.isWhatsApp, false);
    assert.match(theme.bubbleClassName, /bg-blue-600/);
});

test("conversation timeline tint is applied only for WhatsApp conversations", () => {
    assert.match(getConversationTimelineClassName({ isWhatsApp: true }), /f3f5ee/);
    assert.equal(getConversationTimelineClassName({ isWhatsApp: false }), "bg-slate-50/50");
});
