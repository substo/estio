import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiClientConnection } from "@/lib/ai/connections-model";
import type { LocationAiRoutingView } from "@/lib/ai/routing-service";
import { LocationAiSettingsView as LocationAiSettings, type LocationAiSettingsProps } from "./location-ai-settings-view";
import {
  addStep, defaultChain, kindsForFamily, missingKinds, moveStep, removeStep, routingPayload, sameRouting, setTaskModel, summarizeKinds,
} from "./settings-model";

(globalThis as { React?: typeof React }).React = React;

const conn = (c: Partial<AiClientConnection> & Pick<AiClientConnection, "id" | "kind" | "status">): AiClientConnection => ({
  scope: c.kind.startsWith("device_") ? "device" : "location", label: c.id, paid: c.kind === "openai_key" || c.kind === "gemini_key",
  models: [], modelsSource: "catalog", defaultModel: null, ...c,
}) as AiClientConnection;

const populated: AiClientConnection[] = [
  conn({ id: "gemini_key", kind: "gemini_key", status: "not_connected", reason: "Not saved", label: "Google Gemini API key" }),
  conn({ id: "openai_key", kind: "openai_key", status: "ready", label: "OpenAI API key", models: [{ id: "gpt-5.5", label: "GPT-5.5" }] }),
  conn({ id: "chatgpt_subscription", kind: "chatgpt_subscription", status: "ready", label: "ChatGPT subscription", models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
    remainingPercent: 60, usageResetsAt: "2026-11-20T17:00:00Z" }),
  conn({ id: "device_codex:d1", kind: "device_codex", status: "limit_reached", reason: "Codex limit reached", resetsAt: "2026-11-20T18:00:00Z", remainingPercent: 0,
    label: "Codex (ChatGPT) on Studio Mac", deviceId: "d1", mine: true, models: [{ id: "gpt-5.5", label: "gpt-5.5" }], modelsSource: "reported" }),
  conn({ id: "device_claude:d2", kind: "device_claude", status: "ready", label: "Claude on Teammate Mac", mine: false, models: [{ id: "opus", label: "Opus" }] }),
];
const view = (over: Partial<LocationAiRoutingView> = {}): LocationAiRoutingView => ({
  connections: populated, chain: defaultChain(), taskDefaults: {}, saved: false, version: 3,
  budget: { capMicros: 25_000_000, spentMicros: 5_000_000, heldMicros: 10_000, month: "2026-11-01" }, canManage: true, ...over,
});
const render = (props: Partial<LocationAiSettingsProps> = {}) => renderToStaticMarkup(createElement(LocationAiSettings, {
  locationId: "loc_1", routing: view(), openAiKey: { keyHint: "abcd" }, encryptionReady: true, links: { computer: "/settings/computer", gemini: "/settings/integrations/gemini" },
  keyForm: createElement("p", null, "KEY_FORM"), budgetForm: createElement("p", null, "Save cap"), ...props,
}));

test("order editing: move, bounds, add, remove", () => {
  const chain = defaultChain();
  assert.deepEqual(moveStep(chain, 1, -1).map(s => s.kind), ["device_claude", "device_codex", "chatgpt_subscription"]);
  assert.equal(moveStep(chain, 0, -1), chain);
  assert.equal(moveStep(chain, 2, 1), chain);
  assert.deepEqual(addStep(chain, "openai_key").map(s => s.kind).at(-1), "openai_key");
  assert.equal(addStep(chain, "device_codex").length, 3);
  assert.deepEqual(missingKinds(removeStep(chain, 0)), ["device_codex", "openai_key", "gemini_key"]);
});

test("default order has no paid step", () => {
  assert.ok(defaultChain().every(s => s.kind !== "openai_key" && s.kind !== "gemini_key"));
});

test("a teammate's Mac never counts toward the viewer's status", () => {
  const kinds = summarizeKinds(populated);
  assert.equal(kinds.device_claude.status, "not_connected");
  assert.equal(kinds.device_codex.status, "limit_reached");
  assert.equal(kinds.device_codex.resetsAt, "2026-11-20T18:00:00Z");
});

test("task models and payload", () => {
  const next = setTaskModel({}, "extraction", "device_codex", "gpt-5.5");
  assert.deepEqual(next, { extraction: { device_codex: "gpt-5.5" } });
  assert.deepEqual(setTaskModel(next, "extraction", "device_codex", null), {});
  assert.deepEqual(routingPayload(defaultChain(), next, 3).version, 3);
  assert.ok(sameRouting({ chain: defaultChain(), taskDefaults: {} }, { chain: defaultChain(), taskDefaults: {} }));
  assert.deepEqual(kindsForFamily("summaries"), ["device_codex", "device_claude", "chatgpt_subscription", "openai_key", "gemini_key"]);
});

test("populated admin view shows all four sections, statuses, paid marks and the teammate rule", () => {
  const html = render();
  for (const title of ["Connections", "Models per task", "Fallback order", "Usage &amp; limits"]) assert.match(html, new RegExp(`>${title}</h2>`));
  assert.match(html, /Limit reached · resets/);
  assert.match(html, />paid</);
  assert.match(html, /never a teammate&#x27;s subscription/);
  assert.match(html, /This is the default order: no paid steps/);
  assert.match(html, /aria-label="Move Codex down"/);
  assert.match(html, /aria-label="Move Codex up"[^>]*disabled/);
  assert.match(html, /Alt \+ Up or Down arrow/);
  assert.match(html, /href="\/settings\/computer"/);
  assert.match(html, /href="\/settings\/computer#computer-d1"/);
  assert.match(html, /\$5\.00<\/span> spent/);
  assert.match(html, /60% left · resets .*17:00 UTC/);
  assert.match(html, /Save order and models/);
  assert.match(html, /key ending …abcd/);
  assert.doesNotMatch(html, /Teammate Mac/);
});

test("read-only view for non-admins has no editing controls", () => {
  const html = render({ routing: view({ canManage: false }) });
  assert.match(html, /View only/);
  assert.doesNotMatch(html, /Save order and models|Move Codex|Save cap|Add key|Restore default/);
});

test("empty Location: nothing connected, no cap, empty order", () => {
  const html = render({ openAiKey: null, links: { computer: "/settings/computer" },
    routing: view({ connections: [], chain: [], saved: true, budget: { capMicros: 0, spentMicros: 0, heldMicros: 0, month: "2026-11-01" } }) });
  assert.match(html, /Set up your Mac/);
  assert.match(html, /Managed in Estio settings/);
  assert.match(html, /The order is empty/);
  assert.match(html, /No cap set: paid steps are skipped/);
  assert.match(html, /No subscription is connected yet/);
  assert.match(html, /Nothing in the fallback order can run this/);
});
