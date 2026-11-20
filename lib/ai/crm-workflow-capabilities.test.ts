import assert from "node:assert/strict";
import test from "node:test";
import { resolveCrmWorkflowCapabilities } from "./crm-workflow-capabilities";
import { isLikelyPropertyImageAnalysisModel, modelSupportsTask } from "./model-capabilities";
import { quickAssistModelOptions } from "../viewings/sessions/quick-assist-models";
import { buildLiveAssistantPrompt } from "../viewings/sessions/assistant-prompt";
import { AI_WORKFLOW_CONTRACT_VERSION } from "./workflow-capabilities";

test("eligible hosted text subscription cannot unlock API audio, vision or image adapters", () => {
  const sources = { hosted_subscription: { eligible: true } };
  assert.equal(resolveCrmWorkflowCapabilities({ app: "estio", workflow: "live_assistant", sources }).ready, true);
  for (const workflow of ["live_transcription", "live_translation", "replay_speech", "property_image_analysis", "property_image_generation"] as const) {
    const result = resolveCrmWorkflowCapabilities({ app: "estio", workflow, sources });
    assert.equal(result.ready, false, workflow);
    assert.equal(result.quota, "unknown");
    assert.equal(result.liveAcceptance, "unknown");
  }
  const options = quickAssistModelOptions({ google: false, openai: false, codex: true });
  assert.ok(options.assistant.length > 0);
  assert.deepEqual(options.transcribe, []);
  assert.equal(isLikelyPropertyImageAnalysisModel({ value: "chatgpt_subscription:gpt-5.4" }), false);
  assert.equal(modelSupportsTask({ value: "chatgpt_subscription:gpt-5.4" }, "property.image.analysis"), false);
});

test("edition and live model-listing admission are independent of generic connectivity", () => {
  const sources = { google_api: { eligible: true }, openai_api: { eligible: true } };
  assert.equal(resolveCrmWorkflowCapabilities({ app: "substo", workflow: "website_text", sources }).ready, true);
  const blocked = resolveCrmWorkflowCapabilities({ app: "substo", workflow: "live_assistant", sources });
  assert.equal(blocked.reason, "edition_unavailable");
  assert.equal(blocked.ready, false);
  assert.equal(resolveCrmWorkflowCapabilities({ app: "estio", workflow: "live_translation", sources }).ready, false);
  const listed = resolveCrmWorkflowCapabilities({ app: "estio", workflow: "live_translation", sources: { openai_api: { eligible: true, modelListed: true, checkedAt: "fixture" } } });
  assert.equal(listed.ready, true);
  assert.equal(listed.liveAcceptance, "unknown");
  assert.equal(listed.routes.find(route => route.eligible)?.checkedAt, "fixture");
});

test("the direct Gemini Live Assist prompt contains bundled capability guidance and session context", () => {
  const prompt = buildLiveAssistantPrompt({ language: "en", contact: "Fixture contact", property: "Fixture property", reference: "A-1", recentConversation: "Agent: Hello", request: "Help with a reply" });
  assert.ok(prompt.includes(AI_WORKFLOW_CONTRACT_VERSION));
  assert.match(prompt, /crm_live_assistant/);
  assert.match(prompt, /Paid API steps run only when an admin put them in the chain/);
  assert.match(prompt, /Substo connectivity does not unlock Estio property\/viewing workflows/);
  assert.match(prompt, /Fixture contact/);
  assert.match(prompt, /Help with a reply/);
  assert.match(prompt, /Unknown quota/);
});
