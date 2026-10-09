import assert from "node:assert/strict";
import test from "node:test";
import { selectedLanguageMatches, translationTargets } from "./translation-conversation";

test("one shared microphone sends both selected languages to separate targets", () => {
    assert.deepEqual(translationTargets({ role: "agent", participantMode: "agent_only", speechMode: "continuous", agentLanguage: "en", clientLanguage: "pl" }), ["pl", "en"]);
});

test("one-way and separate participant microphones use a single target", () => {
    assert.deepEqual(translationTargets({ role: "agent", participantMode: "agent_only", speechMode: "push_to_talk", agentLanguage: "en", clientLanguage: "pl" }), ["pl"]);
    assert.deepEqual(translationTargets({ role: "client", participantMode: "shared_client", speechMode: "continuous", agentLanguage: "en", clientLanguage: "pl" }), ["en"]);
    assert.deepEqual(translationTargets({ role: "agent", participantMode: "shared_client", speechMode: "continuous", agentLanguage: "en", clientLanguage: "pl" }), ["pl"]);
});

test("regional variants match their selected base language", () => {
    assert.equal(selectedLanguageMatches("en-US", "en"), true);
    assert.equal(selectedLanguageMatches("pl-PL", "en"), false);
});
