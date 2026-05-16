import test from "node:test";
import assert from "node:assert/strict";

import {
    extractPhoneJidCandidate,
    isHighConfidenceResolvedPhone,
    normalizeLidJid,
    normalizeLidRaw,
} from "./identity";

test("rejects low-confidence short fallback phones", () => {
    assert.equal(isHighConfidenceResolvedPhone("0907476"), false);
    assert.equal(isHighConfidenceResolvedPhone("+393477416063"), true);
});

test("extractPhoneJidCandidate only accepts real phone JIDs", () => {
    assert.equal(extractPhoneJidCandidate("393477416063@s.whatsapp.net"), "393477416063");
    assert.equal(extractPhoneJidCandidate("37383579947232@lid"), null);
    assert.equal(extractPhoneJidCandidate("cmm0r9kzt07qpph4j76awlbsy"), null);
});

test("normalizeLidJid canonicalizes plus-prefixed and mixed-case LID values", () => {
    assert.equal(normalizeLidJid("+261692508373041@LID"), "261692508373041@lid");
    assert.equal(normalizeLidRaw("+261692508373041@LID"), "261692508373041");
    assert.equal(normalizeLidJid("393477416063@s.whatsapp.net"), null);
});
