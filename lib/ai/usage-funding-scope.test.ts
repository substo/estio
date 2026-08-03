import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiFundingScope } from "./usage-metering";

test("location API providers receive explicit location funding scopes", () => {
    assert.equal(resolveAiFundingScope("google_gemini"), "location_gemini");
    assert.equal(resolveAiFundingScope("openai"), "location_openai");
});

test("ChatGPT metering rejects ambiguous billing attribution", () => {
    assert.throws(() => resolveAiFundingScope("chatgpt_subscription"), /explicit funding scope/);
    assert.equal(resolveAiFundingScope("chatgpt_subscription", "user_chatgpt"), "user_chatgpt");
    assert.equal(resolveAiFundingScope("chatgpt_subscription", "location_chatgpt"), "location_chatgpt");
});
