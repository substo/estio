import test from "node:test";
import assert from "node:assert/strict";

import {
    languagesMatch,
    resolveConversationLanguageContext,
} from "./language-context";

test("conversation language context prioritizes manual send override", () => {
    const context = resolveConversationLanguageContext({
        manualOverrideLanguage: "fr-FR",
        contactPreferredLanguage: "el",
        latestInboundText: "我正在寻找一套豪华别墅。",
        locationDefaultLanguage: "en",
    });

    assert.equal(context.sendLanguage, "fr-fr");
    assert.equal(context.sendLanguageSource, "conversation_override");
});

test("conversation language context uses contact preferred before latest inbound", () => {
    const context = resolveConversationLanguageContext({
        contactPreferredLanguage: "el",
        latestInboundText: "我正在寻找一套豪华别墅。",
        locationDefaultLanguage: "en",
    });

    assert.equal(context.sendLanguage, "el");
    assert.equal(context.sendLanguageSource, "contact_preferred");
});

test("conversation language context uses latest inbound before location default", () => {
    const context = resolveConversationLanguageContext({
        latestInboundText: "我正在寻找一套豪华别墅。",
        locationDefaultLanguage: "en",
    });

    assert.equal(context.sendLanguage, "zh");
    assert.equal(context.sendLanguageSource, "latest_inbound");
});

test("conversation language context separates view and send language", () => {
    const context = resolveConversationLanguageContext({
        agentWorkingLanguage: "en",
        contactPreferredLanguage: "el",
        locationDefaultLanguage: "en",
    });

    assert.equal(context.viewLanguage, "en");
    assert.equal(context.sendLanguage, "el");
});

test("languagesMatch compares primary language subtags", () => {
    assert.equal(languagesMatch("zh-cn", "zh-tw"), true);
    assert.equal(languagesMatch("en", "el"), false);
});
