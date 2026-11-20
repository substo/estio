import assert from "node:assert/strict";
import test from "node:test";
import { generateContentAiText } from "./content-generation";

test("website generation records actual interactive subscription funding after a pre-generation switch", async () => {
  const calls: unknown[] = [], records: any[] = [];
  const text = await generateContentAiText({ model: "openai:gpt-test", prompt: "Fixture", locationId: "location-a", action: "refineBlockContent" }, {
    generate: async (...args) => {
      calls.push(args);
      return { text: "{\"body\":\"Fixture\"}", provider: "chatgpt_subscription", model: "actual-model",
        fundingScope: "user_chatgpt", executionMode: "interactive",
        route: { operation: "crm_text", requested: { kind: "openai_key", model: "gpt-test" }, actual: { kind: "device_codex", model: "actual-model" }, switchReason: "Limit or quota reached → Your ChatGPT" },
        usage: { promptTokens: 12, completionTokens: 7, totalTokens: 22, thoughtsTokens: 3, toolUsePromptTokens: 0, cachedContentTokens: 2, raw: "{}" } };
    },
    record: async event => { records.push(event); },
  });
  assert.equal(text, '{"body":"Fixture"}');
  assert.deepEqual(calls, [["openai:gpt-test", "Fixture", undefined, { jsonMode: true, temperature: undefined, locationId: "location-a", executionMode: "interactive" }]]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { locationId: "location-a", resourceType: "website", featureArea: "website_content", action: "refineBlockContent",
    provider: "chatgpt_subscription", model: "actual-model", inputTokens: 12, outputTokens: 10, fundingScope: "user_chatgpt", executionMode: "interactive",
    metadata: { requestedModel: "gpt-test", cachedContentTokens: 2, routeOperation: "crm_text", requestedKind: "openai_key",
      actualKind: "device_codex", actualModel: "actual-model", switchReason: "Limit or quota reached → Your ChatGPT" } });
});

test("a rejected website provider call does not create a successful usage event or retry elsewhere", async () => {
  let calls = 0, records = 0;
  await assert.rejects(generateContentAiText({ model: "gemini-test", prompt: "Fixture", locationId: "location-a", action: "generateSiteTheme" }, {
    generate: async () => { calls++; throw new Error("provider rejected"); },
    record: async () => { records++; },
  }), /provider rejected/);
  assert.equal(calls, 1);
  assert.equal(records, 0);
});
