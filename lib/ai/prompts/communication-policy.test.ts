import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097 required for Node --experimental-strip-types test runner
import { buildDealProtectiveCommunicationContract, detectLanguageFromText, resolveCommunicationLanguage } from "./communication-policy.ts";

test("resolveCommunicationLanguage prefers contact language over inbound detection", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "Καλησπέρα, ενδιαφέρομαι για το ακίνητο.",
        contactPreferredLanguage: "en",
        threadText: "Agent: Hello\nContact: Καλησπέρα",
    });

    assert.equal(resolution.expectedLanguage, "en");
    assert.equal(resolution.source, "contact_preferred");
});

test("resolveCommunicationLanguage prioritizes explicit manual override", () => {
    const resolution = resolveCommunicationLanguage({
        manualOverrideLanguage: "fr-FR",
        latestInboundText: "Καλησπέρα, ενδιαφέρομαι για το ακίνητο.",
        contactPreferredLanguage: "en",
        threadText: "Agent: Hello\nContact: Καλησπέρα",
    });

    assert.equal(resolution.expectedLanguage, "fr-fr");
    assert.equal(resolution.source, "conversation_override");
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

test("resolveCommunicationLanguage defaults to English when contact preference is ignored and no language is detected", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "ok",
        contactPreferredLanguage: "pt",
        threadText: "Agent: Thanks",
        fallbackLanguage: "en",
        useContactPreferredLanguage: false,
    });

    assert.equal(resolution.expectedLanguage, "en");
    assert.equal(resolution.source, "thread_default");
});

test("resolveCommunicationLanguage uses latest inbound when no override/default", () => {
    const resolution = resolveCommunicationLanguage({
        latestInboundText: "Καλησπέρα, ενδιαφέρομαι για το ακίνητο.",
        contactPreferredLanguage: null,
        threadText: "Agent: Hello\nContact: Thanks",
    });

    assert.equal(resolution.expectedLanguage, "el");
    assert.equal(resolution.source, "latest_inbound");
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

test("resolveCommunicationLanguage normalizes underscore tags", () => {
    const resolution = resolveCommunicationLanguage({
        manualOverrideLanguage: "en_US",
    });

    assert.equal(resolution.expectedLanguage, "en-us");
    assert.equal(resolution.source, "conversation_override");
});

test("resolveCommunicationLanguage ignores invalid override and falls back", () => {
    const resolution = resolveCommunicationLanguage({
        manualOverrideLanguage: "???",
        contactPreferredLanguage: "fr",
    });

    assert.equal(resolution.expectedLanguage, "fr");
    assert.equal(resolution.source, "contact_preferred");
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
    assert.match(contract, /place it on its own line/i);
    assert.match(contract, /trailing punctuation/i);
    assert.match(contract, /only when the context actually contains uncertainty/i);
    assert.match(contract, /preserve that meaning and phrasing style/i);
    assert.match(contract, /Use these phrasing patterns only when the context genuinely requires them/i);
});
