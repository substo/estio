import test from "node:test";
import assert from "node:assert/strict";
import { getConversationSurfaceTheme, getConversationTimelineClassName, getMessageBubbleTheme } from "./message-bubble-theme";

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

test("WhatsApp outbound shared contact card uses readable light-bubble colors", () => {
    const theme = getMessageBubbleTheme({
        isWhatsApp: true,
        isSMS: false,
        isEmail: false,
        isOutbound: true,
    });

    assert.match(theme.sharedContactCardClassName, /emerald|white/);
    assert.match(theme.sharedContactNameClassName, /slate|gray/);
    assert.match(theme.sharedContactInfoLinkClassName, /slate|emerald/);
    assert.doesNotMatch(theme.sharedContactNameClassName, /text-white/);
    assert.doesNotMatch(theme.sharedContactPrimaryActionClassName, /bg-white\/20/);
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

test("conversation surface theme follows selected messaging platform", () => {
    const whatsApp = getConversationSurfaceTheme("WhatsApp");
    const sms = getConversationSurfaceTheme("SMS");
    const email = getConversationSurfaceTheme("Email");

    assert.equal(whatsApp.channel, "WhatsApp");
    assert.match(whatsApp.timelineClassName, /f3f5ee|emerald/);
    assert.match(whatsApp.composerPrimaryButtonClassName, /emerald/);
    assert.doesNotMatch(whatsApp.composerPrimaryButtonClassName, /blue/);

    assert.equal(sms.channel, "SMS");
    assert.match(sms.composerPrimaryButtonClassName, /blue/);

    assert.equal(email.channel, "Email");
    assert.match(email.composerPrimaryButtonClassName, /violet/);
});
