import assert from "node:assert/strict";
import test from "node:test";

import { getWhatsAppHistorySyncResultMessage } from "./whatsapp-history-sync-ui";

test("reports imported WhatsApp messages", () => {
    assert.equal(
        getWhatsAppHistorySyncResultMessage({ count: 2, processed: 5, identityResolved: true }),
        "Added 2 messages from WhatsApp. The timeline is now up to date.",
    );
});

test("distinguishes an up-to-date chat from an empty sync", () => {
    assert.equal(
        getWhatsAppHistorySyncResultMessage({ count: 0, processed: 12, skipped: 12, identityResolved: true }),
        "WhatsApp history is already up to date. Checked 12 messages.",
    );
    assert.equal(
        getWhatsAppHistorySyncResultMessage({ count: 0, processed: 0, identityResolved: false }),
        "No matching WhatsApp chat identity was found for this contact.",
    );
});

test("surfaces provider read failures", () => {
    assert.equal(
        getWhatsAppHistorySyncResultMessage({ errors: 1, identityResolved: true }),
        "WhatsApp history could not be read from the resolved chat. Try again after checking the connection.",
    );
});
