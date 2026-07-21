import assert from "node:assert/strict";
import test from "node:test";

import {
    buildInboundWhatsAppNotificationContent,
    dedupeLocationNotificationRecipientIds,
    isInboundWhatsAppNotificationFresh,
} from "./inbound-whatsapp";

test("buildInboundWhatsAppNotificationContent is privacy-safe and links to the conversation", () => {
    assert.deepEqual(buildInboundWhatsAppNotificationContent("conversation/id"), {
        title: "New WhatsApp message",
        body: "Open Estio to view and reply.",
        deepLinkUrl: "/admin/conversations?mode=chats&id=conversation%2Fid",
    });
});

test("dedupeLocationNotificationRecipientIds combines role and legacy membership rows", () => {
    assert.deepEqual(dedupeLocationNotificationRecipientIds([
        { id: "user-1" },
        { userId: "user-1" },
        { userId: " user-2 " },
        { id: null },
    ]), ["user-1", "user-2"]);
});

test("isInboundWhatsAppNotificationFresh rejects startup replays and invalid timestamps", () => {
    const now = new Date("2026-07-21T17:00:00.000Z");
    assert.equal(isInboundWhatsAppNotificationFresh(new Date("2026-07-21T16:55:00.000Z"), now), true);
    assert.equal(isInboundWhatsAppNotificationFresh(new Date("2026-07-21T14:42:03.000Z"), now), false);
    assert.equal(isInboundWhatsAppNotificationFresh(new Date("invalid"), now), false);
});
