import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, sanitizeModelInputValue } from "@/lib/viewings/sessions/redaction";

test("redacts email, phone, and id-like values from free text", () => {
    const input = "Email me at demo.agent@example.com or call +357 99 123 456. Ref: ABCD1234ZX.";
    const redacted = redactSensitiveText(input);

    assert.equal(redacted.includes("[REDACTED_EMAIL]"), true);
    assert.equal(redacted.includes("[REDACTED_PHONE]"), true);
    assert.equal(redacted.includes("[REDACTED_ID]"), true);
});

test("sanitizes nested model payloads and masks internal-only note fields", () => {
    const payload = {
        contact: {
            phone: "+35799123456",
            email: "lead@example.com",
        },
        internalNotes: "Never disclose this private internal note.",
        nested: [
            {
                ownerNotes: "Budget and private constraints",
                ref: "LEADX12345",
            },
        ],
    };

    const sanitized = sanitizeModelInputValue(payload);
    const serialized = JSON.stringify(sanitized);

    assert.equal(serialized.includes("[REDACTED_PHONE]"), true);
    assert.equal(serialized.includes("[REDACTED_EMAIL]"), true);
    assert.equal(serialized.includes("[REDACTED_INTERNAL_NOTE]"), true);
    assert.equal(serialized.includes("Never disclose"), false);
});
