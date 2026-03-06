import test from "node:test";
import assert from "node:assert/strict";
import {
    buildDealProtectiveCommunicationContract,
    detectLanguageFromText,
    resolveCommunicationLanguage
} from "./communication-policy";

test("resolveCommunicationLanguage prefers latest inbound language", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "Καλησπέρα, ενδιαφέρομαι για το ακίνητο.",
        contactPreferredLanguage: "en",
        threadText: "Agent: Hello\nContact: Καλησπέρα",
    });

    assert.equal(resolution.expectedLanguage, "el");
    assert.equal(resolution.source, "latest_inbound");
});

test("resolveCommunicationLanguage falls back to preferred language", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "ok",
        contactPreferredLanguage: "fr",
        threadText: "Agent: Thanks",
    });

    assert.equal(resolution.expectedLanguage, "fr");
    assert.equal(resolution.source, "contact_preferred");
});

test("resolveCommunicationLanguage falls back to thread default language", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "",
        contactPreferredLanguage: null,
        threadText: "Contact: Καλημέρα, θα ήθελα πληροφορίες.",
    });

    assert.equal(resolution.expectedLanguage, "el");
    assert.equal(resolution.source, "thread_default");
});

test("detectLanguageFromText identifies greek script", () => {
    assert.equal(detectLanguageFromText("Θα ήθελα πληροφορίες για το ακίνητο."), "el");
});

test("communication contract includes core deal-protective constraints", () => {
    const contract = buildDealProtectiveCommunicationContract({
        expectedLanguage: "el",
        contextLabel: "test",
    });

    assert.match(contract, /Reply in Greek/i);
    assert.match(contract, /non-pushy/i);
    assert.match(contract, /Avoid transactional finality/i);
});
