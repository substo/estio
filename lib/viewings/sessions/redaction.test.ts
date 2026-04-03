import assert from "node:assert/strict";
import test from "node:test";
import {
    prepareTranslationModelText,
    redactSensitiveText,
    sanitizeAnalysisModelInputValue,
    sanitizeLiveToolOutputValue,
    sanitizeModelInputValue,
} from "@/lib/viewings/sessions/redaction";

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

test("translation preparation preserves original contact tokens for fidelity", () => {
    const input = "Call +357 99 123 456 or email lead@example.com about ref ABCD1234ZX.";
    const prepared = prepareTranslationModelText(input);

    assert.equal(prepared, input);
});

test("analysis and live tool sanitizers redact sensitive tokens on secondary paths", () => {
    const input = {
        phone: "+357 99 123 456",
        email: "lead@example.com",
        internalNotes: "Only for the internal team",
        ref: "ABCD1234ZX",
    };

    const analysisSanitized = JSON.stringify(sanitizeAnalysisModelInputValue(input));
    const liveToolSanitized = JSON.stringify(sanitizeLiveToolOutputValue(input));

    for (const serialized of [analysisSanitized, liveToolSanitized]) {
        assert.equal(serialized.includes("[REDACTED_PHONE]"), true);
        assert.equal(serialized.includes("[REDACTED_EMAIL]"), true);
        assert.equal(serialized.includes("[REDACTED_ID]"), true);
        assert.equal(serialized.includes("[REDACTED_INTERNAL_NOTE]"), true);
        assert.equal(serialized.includes("Only for the internal team"), false);
    }
});
