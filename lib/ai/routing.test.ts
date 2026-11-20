import assert from "node:assert/strict";
import test from "node:test";
import { assembleLocationAiConnections, toClientConnection, type AiConnectionInputs } from "./connections-model";
import { DEFAULT_AI_ROUTING, aiRoutingSettingsSchema, nextAiRoute, readAiRoutingSettings, resolveAiRoute, type AiRoutingSettings } from "./routing";

const now = Date.parse("2026-11-20T10:00:00Z"), recent = "2026-11-20T09:59:30Z";
const signedIn = (login: string) => ({ installed: true, authenticated: true, ready: true, loginMethod: login });
const mac = (id: string, createdBy: string, capacity: { codex?: boolean; claude?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, name: `${createdBy} Mac`, createdBy, revoked: false, paused: false, processingEnabled: true, seenAt: recent, draining: false,
  capabilities: { codex: signedIn("chatgpt"), claude: signedIn("claudeai"), capacity, ...extra },
});
const base: AiConnectionInputs = { geminiKey: true, openAiKey: true, chatGpt: { enabled: true, health: "connected", hasCredential: true }, devices: [],
  catalogs: { openai_key: [{ id: "gpt-5.4", label: "GPT-5.4" }], gemini_key: [{ id: "gemini-flash-latest", label: "Gemini Flash" }] } };
const chain = (...kinds: AiRoutingSettings["chain"][number]["kind"][]): AiRoutingSettings => ({ version: 1, chain: kinds.map(kind => ({ kind, model: null })), taskDefaults: {} });
const budget = { capMicros: 25_000_000, usedMicros: 0, estimateMicros: 10_000 };
const me = { userId: "user_me" };
const connections = (devices: AiConnectionInputs["devices"], overrides: Partial<AiConnectionInputs> = {}) => assembleLocationAiConnections({ ...base, ...overrides, devices }, now);

test("limit reached on Codex moves to Claude on the same Mac, with the reset time in the switch reason", () => {
  const usage = { codex: { remaining: 0, windows: [{ label: "5h", remaining: 0, resetsAt: "2026-11-20T12:00:00Z" }], at: "2026-11-20T09:58:00Z" } };
  const list = connections([mac("d1", "user_me", { codex: false, claude: true }, { usage })]);
  const codex = list.find(c => c.kind === "device_codex")!;
  assert.equal(codex.status, "limit_reached"); assert.equal(codex.resetsAt, "2026-11-20T12:00:00Z");
  const r = resolveAiRoute({ operation: "knowledge_extract", settings: chain("device_codex", "device_claude", "openai_key"), connections: list, requester: me, budget });
  assert.deepEqual(r.candidates.map(c => c.kind), ["device_claude", "openai_key"]);
  assert.deepEqual(r.requested, { kind: "device_codex", model: null });
  assert.equal(r.switchReason, "Codex limit reached (resets 2026-11-20T12:00:00Z) → Claude");
  assert.equal(r.candidates[0].deviceId, "d1");
});

test("a paid step that the admin did not put in the chain is never used; the stop reason says why", () => {
  const list = connections([mac("d1", "user_me", { codex: false, claude: false })]);
  const r = resolveAiRoute({ operation: "idea_review", settings: chain("device_codex", "device_claude"), connections: list, requester: me, budget });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.stopReason, "Codex limit reached; Claude limit reached");
  assert.ok(!r.skipped.some(s => s.kind === "openai_key" || s.kind === "gemini_key"));
});

test("paid steps need a monthly cap and room under it", () => {
  const list = connections([]);
  const settings = chain("openai_key");
  assert.equal(resolveAiRoute({ operation: "script_brief", settings, connections: list, requester: me, budget: null }).stopReason, "OpenAI API: no monthly cap set");
  assert.equal(resolveAiRoute({ operation: "script_brief", settings, connections: list, requester: me, budget: { ...budget, usedMicros: 24_995_000 } }).stopReason, "OpenAI API: monthly cap reached");
  assert.deepEqual(resolveAiRoute({ operation: "script_brief", settings, connections: list, requester: me, budget }).candidates.map(c => [c.kind, c.model, c.paid]), [["openai_key", "gpt-5.4", true]]);
});

test("a teammate's Mac is never used, even when it is the only ready subscription", () => {
  const list = connections([mac("d2", "user_teammate", { codex: true, claude: true })]);
  const r = resolveAiRoute({ operation: "knowledge_extract", settings: chain("device_codex", "device_claude"), connections: list, requester: me, budget });
  assert.deepEqual(r.candidates, []);
  assert.equal(r.stopReason, "Codex isn't set up on your Mac; Claude isn't set up on your Mac");
  // Browser view hides the owner id and marks ownership only for the viewer.
  const client = toClientConnection(list.find(c => c.kind === "device_codex")!, "user_me");
  assert.equal("ownerUserId" in client, false); assert.equal(client.mine, false);
});

test("background work skips personal steps and uses Location-owned connections", () => {
  const list = connections([mac("d1", "user_me", { codex: true, claude: true })]);
  const r = resolveAiRoute({ operation: "onboarding_research", settings: chain("device_codex", "chatgpt_subscription"), connections: list, requester: null, budget });
  assert.deepEqual(r.candidates.map(c => c.kind), ["chatgpt_subscription"]);
  assert.match(r.skipped[0].reason, /background work can't use a personal subscription/);
});

test("capability mismatch is skipped: no audio through a text subscription, no hosted ChatGPT for Studio text", () => {
  const list = connections([mac("d1", "user_me", { codex: true, claude: true })]);
  const audio = resolveAiRoute({ operation: "audio_transcription", settings: chain("device_codex", "chatgpt_subscription", "openai_key"), connections: list, requester: me, budget });
  assert.deepEqual(audio.candidates.map(c => c.kind), ["openai_key"]);
  assert.equal(audio.skipped[0].reason, "Codex can't handle audio");
  assert.equal(audio.requested?.kind, "openai_key");
  const studio = resolveAiRoute({ operation: "knowledge_extract", settings: chain("chatgpt_subscription", "device_claude"), connections: list, requester: me, budget });
  assert.deepEqual(studio.candidates.map(c => c.kind), ["device_claude"]);
  assert.equal(studio.skipped[0].reason, "Location ChatGPT isn't supported for knowledge extract");
});

test("an uncertain or started run is never replayed on the next step; a pre-generation limit moves on", () => {
  const list = connections([mac("d1", "user_me", { codex: true, claude: true })]);
  const r = resolveAiRoute({ operation: "knowledge_extract", settings: chain("device_codex", "device_claude", "openai_key"), connections: list, requester: me, budget });
  assert.deepEqual(nextAiRoute(r, "device_codex", { stage: "uncertain", reason: "Codex stopped" }), { next: null, stopReason: "This run already started, so it isn't replayed automatically. Start a new request." });
  assert.equal(nextAiRoute(r, "device_codex", { stage: "started", reason: "Codex stopped" }).next, null);
  const moved = nextAiRoute(r, "device_codex", { stage: "before_generation", reason: "Codex limit reached" });
  assert.equal(moved.next?.kind, "device_claude"); assert.equal("switchReason" in moved && moved.switchReason, "Codex limit reached → Claude");
  assert.equal(nextAiRoute(r, "openai_key", { stage: "before_generation", reason: "OpenAI quota" }).next, null);
});

test("models: task default beats step model; a Mac-reported list must contain the model; curated lists are not enforced", () => {
  const reported = mac("d1", "user_me", { codex: true, claude: true }, { codex: { ...signedIn("chatgpt"), models: ["gpt-5.5", "gpt-5.5-codex"] } });
  const list = connections([reported]);
  assert.deepEqual(list.find(c => c.kind === "device_codex")!.models.map(m => m.id), ["gpt-5.5", "gpt-5.5-codex"]);
  assert.equal(list.find(c => c.kind === "device_claude")!.modelsSource, "curated");
  const settings: AiRoutingSettings = { version: 1, chain: [{ kind: "device_codex", model: "gpt-5.4" }, { kind: "device_claude", model: "opus" }], taskDefaults: { extraction: { device_codex: "gpt-5.5-codex" } } };
  assert.deepEqual(resolveAiRoute({ operation: "knowledge_extract", settings, connections: list, requester: me, budget }).candidates.map(c => c.model), ["gpt-5.5-codex", "opus"]);
  const r = resolveAiRoute({ operation: "idea_review", settings, connections: list, requester: me, budget });
  assert.deepEqual(r.candidates.map(c => c.kind), ["device_claude"]);
  assert.equal(r.skipped[0].reason, "Codex: model gpt-5.4 isn't available");
});

test("settings validate: unique steps, known kinds, safe model ids; unreadable settings fall back to no-paid default", () => {
  assert.equal(aiRoutingSettingsSchema.safeParse({ chain: [{ kind: "device_codex" }, { kind: "device_codex" }] }).success, false);
  assert.equal(aiRoutingSettingsSchema.safeParse({ chain: [{ kind: "anthropic_key" }] }).success, false);
  assert.equal(aiRoutingSettingsSchema.safeParse({ chain: [{ kind: "openai_key", model: "gpt 5; rm" }] }).success, false);
  assert.deepEqual(readAiRoutingSettings({ chain: [{ kind: "openai_key" }] }).chain, [{ kind: "openai_key", model: null }]);
  assert.equal(readAiRoutingSettings("nonsense"), DEFAULT_AI_ROUTING);
  assert.ok(!DEFAULT_AI_ROUTING.chain.some(s => s.kind === "openai_key" || s.kind === "gemini_key"));
});

test("connection statuses: signed out, offline, paused, no reading", () => {
  const stale = { ...mac("d1", "user_me", { codex: true }), seenAt: "2026-11-20T09:00:00Z" };
  assert.equal(connections([stale]).find(c => c.kind === "device_codex")!.status, "offline");
  assert.equal(connections([{ ...mac("d1", "user_me", { codex: true }), paused: true }]).find(c => c.kind === "device_codex")!.reason, "Paused");
  assert.equal(connections([mac("d1", "user_me", {})]).find(c => c.kind === "device_claude")!.status, "unavailable");
  const out = connections([mac("d1", "user_me", { codex: true }, { codex: { installed: true, authenticated: true, loginMethod: "api_key" } })]);
  assert.equal(out.find(c => c.kind === "device_codex")!.status, "not_connected");
  assert.equal(connections([], { openAiKey: false }).find(c => c.kind === "openai_key")!.status, "not_connected");
});
