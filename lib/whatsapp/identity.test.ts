import test from "node:test";
import assert from "node:assert/strict";

import {
    evolutionContactMatchesRequestedJid,
    extractPhoneFromEvolutionContact,
    extractPhoneJidCandidate,
    isHighConfidenceResolvedPhone,
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

test("evolutionContactMatchesRequestedJid requires an exact JID match", () => {
    const contact = {
        id: "cmm0r9kzt07qpph4j76awlbsy",
        remoteJid: "37383579947232@lid",
    };

    assert.equal(evolutionContactMatchesRequestedJid(contact, "37383579947232@lid"), true);
    assert.equal(evolutionContactMatchesRequestedJid(contact, "112738663714895@lid"), false);
});

test("extractPhoneFromEvolutionContact ignores internal ids and unresolved lid-only rows", () => {
    const unresolvedLidContact = {
        id: "cmm0r9kzt07qpph4j76awlbsy",
        remoteJid: "37383579947232@lid",
        pushName: "",
    };

    assert.equal(extractPhoneFromEvolutionContact(unresolvedLidContact), null);
});

test("extractPhoneFromEvolutionContact accepts explicit phone metadata", () => {
    const contact = {
        remoteJid: "37383579947232@lid",
        remoteJidAlt: "393477416063@s.whatsapp.net",
        phoneNumber: "393477416063",
    };

    assert.equal(extractPhoneFromEvolutionContact(contact), "393477416063");
});
