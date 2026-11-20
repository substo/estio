import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import assert from "node:assert/strict";
import test from "node:test";
import type { AiConnection } from "./connections-model";
import { legacyTaskModels, modelKind, planCrmRoute, runCrmRoute } from "./crm-routing";
import { AiProviderRejectedError, AiRouteUnavailableError, classifyAiAttemptFailure } from "./route-errors";
import { DEFAULT_AI_ROUTING, type AiRoutingSettings } from "./routing";

const conn = (kind: AiConnection["kind"], status: AiConnection["status"] = "ready", extra: Partial<AiConnection> = {}): AiConnection => ({
  id: kind, kind, scope: "location", label: kind, status, paid: kind === "openai_key" || kind === "gemini_key", models: [], modelsSource: "catalog", defaultModel: null, ...extra,
});
const mac = (kind: "device_codex" | "device_claude"): AiConnection => ({ ...conn(kind), id: `${kind}:m1`, scope: "device", deviceId: "m1", ownerUserId: "user_a", paid: false });
const all = [conn("gemini_key"), conn("openai_key"), conn("chatgpt_subscription"), mac("device_codex"), mac("device_claude")];
const saved = (chain: AiRoutingSettings["chain"], taskDefaults: AiRoutingSettings["taskDefaults"] = {}): AiRoutingSettings => ({ version: 1, chain, taskDefaults });
const budget = { capMicros: 1_000_000, usedMicros: 0, estimateMicros: 10_000 };
const defaults = { gemini_key: "gemini-flash-latest", openai_key: "gpt-4o-mini", chatgpt_subscription: "gpt-5.4-mini" };

test("stored model values map onto connection kinds and legacy per-task fields", () => {
  assert.equal(modelKind("openai:gpt-5"), "openai_key");
  assert.equal(modelKind("chatgpt_subscription:gpt-5.4"), "chatgpt_subscription");
  assert.equal(modelKind("gemini-2.5-flash"), "gemini_key");
  assert.deepEqual(legacyTaskModels({ googleAiModelTranslation: "gemini-flash-lite-latest", openAiTextModel: "openai:gpt-5" }, "translation"),
    { gemini_key: "gemini-flash-lite-latest", openai_key: "gpt-5" });
  assert.deepEqual(legacyTaskModels({ googleAiModelExtraction: "openai:gpt-5-mini", googleAiModel: "gemini-2.5-pro" }, "extraction"),
    { openai_key: "gpt-5-mini", gemini_key: "gemini-2.5-pro" });
});

test("Phase A's no-paid default applies even when a Location has a legacy paid model", () => {
  const payload = { googleAiModel: "gemini-2.5-pro" };
  const plan = planCrmRoute({ operation: "crm_text", settings: DEFAULT_AI_ROUTING, payload,
    connections: all, interactive: true, budget, defaults });
  assert.deepEqual(plan.steps.map(s => [s.kind, s.personal]), [["device_codex", true], ["chatgpt_subscription", false]]);
  const background = planCrmRoute({ operation: "onboarding_research", settings: DEFAULT_AI_ROUTING, payload,
    connections: all, interactive: false, budget, defaults });
  assert.deepEqual(background.steps.map(s => s.kind), ["chatgpt_subscription"]);
  const migrated = planCrmRoute({ operation: "crm_text", settings: saved([{ kind: "gemini_key", model: null }]), payload,
    connections: all, interactive: false, budget, defaults });
  assert.equal(migrated.steps[0]?.model, "gemini-2.5-pro");
});

test("a saved chain decides the provider; task models beat step models, hints and legacy fields; picks win only when explicit", () => {
  const settings = saved([{ kind: "device_claude", model: null }, { kind: "chatgpt_subscription", model: null }, { kind: "gemini_key", model: "gemini-2.5-flash" }],
    { translation: { gemini_key: "gemini-flash-lite-latest" } });
  const text = planCrmRoute({ operation: "crm_text", settings, payload: { googleAiModel: "gemini-2.5-pro" }, connections: all, interactive: false, budget, defaults, hintModel: "gemini-3-pro" });
  assert.deepEqual(text.steps.map(s => [s.kind, s.model]), [["chatgpt_subscription", "gpt-5.4-mini"], ["gemini_key", "gemini-2.5-flash"]]);
  assert.match(text.skipped.find(s => s.kind === "device_claude")!.reason, /don't run on a Mac/);
  const translation = planCrmRoute({ operation: "crm_translation", settings, payload: {}, connections: all, interactive: false, budget, defaults, hintModel: "gemini-3-pro" });
  assert.equal(translation.steps[1].model, "gemini-flash-lite-latest");
  const explicit = planCrmRoute({ operation: "crm_translation", settings, payload: {}, connections: all, interactive: true, budget, defaults, hintModel: "gemini-3-pro", explicitModel: true });
  assert.equal(explicit.steps[1].model, "gemini-3-pro");
  assert.equal(explicit.steps[0].kind, "chatgpt_subscription", "an explicit Gemini pick does not override the chain's order");
});

test("paid steps need to be in the chain and within the monthly cap; unavailable steps are skipped with a reason", () => {
  const settings = saved([{ kind: "chatgpt_subscription", model: null }, { kind: "openai_key", model: null }, { kind: "gemini_key", model: null }]);
  const connections = [conn("chatgpt_subscription", "unavailable", { reason: "Needs reconnecting" }), conn("openai_key"), conn("gemini_key")];
  const noCap = planCrmRoute({ operation: "crm_text", settings, connections, interactive: false, budget: { ...budget, capMicros: 0 }, defaults });
  assert.deepEqual(noCap.steps, []);
  assert.match(noCap.stopReason!, /no monthly cap set/);
  const capped = planCrmRoute({ operation: "crm_text", settings, connections, interactive: false, budget: { ...budget, usedMicros: 995_000 }, defaults });
  assert.match(capped.stopReason!, /monthly cap reached/);
  const ok = planCrmRoute({ operation: "crm_text", settings, connections, interactive: false, budget, defaults });
  assert.deepEqual(ok.steps.map(s => s.kind), ["openai_key", "gemini_key"]);
  assert.equal(ok.requested?.kind, "chatgpt_subscription");
  assert.match(ok.switchReason!, /Location ChatGPT: needs reconnecting → OpenAI API/);
  const noPaid = planCrmRoute({ operation: "crm_text", settings: saved([{ kind: "chatgpt_subscription", model: null }]), connections: all, interactive: false, budget, defaults });
  assert.deepEqual(noPaid.steps.map(s => s.kind), ["chatgpt_subscription"], "a key that is not in the chain is never used");
});

test("onboarding cannot select a personal credential even with an interactive caller", () => {
  const settings = saved([{ kind: "device_codex", model: null }, { kind: "chatgpt_subscription", model: null }]);
  for (const operation of ["onboarding_answer", "onboarding_research"] as const) {
    const plan = planCrmRoute({ operation, settings, connections: all, interactive: true, budget, defaults });
    assert.deepEqual(plan.steps.map(s => s.kind), ["chatgpt_subscription"]);
  }
});

test("the runner switches only on failures before generation and records requested vs actual", async () => {
  const settings = saved([{ kind: "device_codex", model: null }, { kind: "chatgpt_subscription", model: null }, { kind: "openai_key", model: null }, { kind: "gemini_key", model: null }]);
  const plan = planCrmRoute({ operation: "crm_text", settings, connections: all, interactive: true, budget, defaults });
  const tried: string[] = [];
  const result = await runCrmRoute(plan, async step => {
    tried.push(step.kind);
    if (step.kind === "device_codex") throw new AiRouteUnavailableError("Your ChatGPT isn't connected");
    if (step.kind === "chatgpt_subscription") throw new AiProviderRejectedError("limit", 429);
    return `ran ${step.kind}`;
  });
  assert.deepEqual(tried, ["device_codex", "chatgpt_subscription", "openai_key"]);
  assert.equal(result.value, "ran openai_key");
  assert.equal(result.route.requested?.kind, "device_codex");
  assert.equal(result.route.actual.kind, "openai_key");
  assert.match(result.route.switchReason!, /Limit or quota reached → OpenAI API/);

  const started: string[] = [];
  await assert.rejects(runCrmRoute(plan, async step => { started.push(step.kind); throw new Error("socket hang up after output"); }), /socket hang up/);
  assert.deepEqual(started, ["device_codex"], "an uncertain run is never replayed on another step");
  await assert.rejects(runCrmRoute({ ...plan, steps: [] }, async () => "never"), /No AI connection in this Location's order can run this now/);
});

test("failure classification: limit, quota and credential rejections precede generation", () => {
  assert.equal(classifyAiAttemptFailure(new AiProviderRejectedError("x", 429)).stage, "before_generation");
  assert.equal(classifyAiAttemptFailure(new AiProviderRejectedError("x", 401)).stage, "before_generation");
  assert.equal(classifyAiAttemptFailure(new AiProviderRejectedError("x", 500)).stage, "uncertain");
  assert.equal(classifyAiAttemptFailure(new GoogleGenerativeAIFetchError("RESOURCE_EXHAUSTED", 429, "Too Many Requests")).stage, "before_generation");
  assert.equal(classifyAiAttemptFailure(Object.assign(new Error("quota"), { status: 429 })).stage, "uncertain");
  assert.equal(classifyAiAttemptFailure(new Error("The ChatGPT connection needs attention.")).stage, "uncertain");
  assert.equal(classifyAiAttemptFailure(new Error("Stream closed: RESOURCE_EXHAUSTED")).stage, "uncertain");
});
