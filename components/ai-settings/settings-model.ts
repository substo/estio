import type { AiClientConnection, AiConnectionStatus, AiModelOption } from "@/lib/ai/connections-model";
import { AI_KIND_LABELS, DEFAULT_AI_ROUTING, type AiRouteStep, type AiRoutingSettings } from "@/lib/ai/routing";
import {
  AI_CONNECTION_KINDS, AI_ROUTED_OPERATIONS, AI_TASK_FAMILIES, PAID_CONNECTION_KINDS, PERSONAL_CONNECTION_KINDS,
  type AiConnectionKind, type AiTaskFamily,
} from "@/lib/ai/workflow-capabilities";

/**
 * Client-safe view logic for the shared Location AI settings (Estio /settings/ai). Pure so ordering, labels and the
 * save payload are testable without a browser. The backend is lib/ai/routing-service.ts (GET/PUT /api/studio/ai-routing).
 */
export { AI_KIND_LABELS };
export const isPaidKind = (kind: AiConnectionKind) => PAID_CONNECTION_KINDS.includes(kind);
export const isPersonalKind = (kind: AiConnectionKind) => PERSONAL_CONNECTION_KINDS.includes(kind);

export const STATUS_LABELS: Record<AiConnectionStatus, string> = {
  ready: "Ready", limit_reached: "Limit reached", unavailable: "Unavailable", not_connected: "Not connected", offline: "Offline",
};
const STATUS_RANK: Record<AiConnectionStatus, number> = { ready: 0, limit_reached: 1, unavailable: 2, offline: 3, not_connected: 4 };

export const TASK_FAMILY_LABELS: Record<AiTaskFamily, { label: string; description: string }> = {
  text: { label: "Writing and review", description: "Idea reviews, script briefs, source assistant, CRM text" },
  extraction: { label: "Extraction", description: "Knowledge extraction, video templates, onboarding answers" },
  translation: { label: "Translation", description: "CRM translation" },
  summaries: { label: "Summaries", description: "Library summaries" },
  research: { label: "Research", description: "Related videos, onboarding research" },
};

/** Connection kinds that can run at least one text operation in this task family (from AI_ROUTED_OPERATIONS). */
export function kindsForFamily(family: AiTaskFamily): AiConnectionKind[] {
  const kinds = new Set<AiConnectionKind>();
  for (const spec of Object.values(AI_ROUTED_OPERATIONS))
    if (spec.family === family && spec.modality === "text") for (const kind of spec.kinds) kinds.add(kind);
  return AI_CONNECTION_KINDS.filter(kind => kinds.has(kind));
}
export const TASK_FAMILIES = AI_TASK_FAMILIES;

/** One row per connection kind: the best status among the viewer's connections of that kind and the merged model list. */
export type KindSummary = {
  kind: AiConnectionKind; label: string; status: AiConnectionStatus; reason?: string; resetsAt?: string;
  paid: boolean; personal: boolean; models: AiModelOption[]; connections: AiClientConnection[];
};
export function summarizeKinds(connections: AiClientConnection[]): Record<AiConnectionKind, KindSummary> {
  const out = {} as Record<AiConnectionKind, KindSummary>;
  for (const kind of AI_CONNECTION_KINDS) {
    // Personal steps only ever use the viewer's own Mac, so a teammate's Mac never counts toward a status.
    const own = connections.filter(c => c.kind === kind && (c.scope !== "device" || c.mine !== false));
    const best = [...own].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])[0];
    const models = new Map<string, AiModelOption>();
    for (const c of own) for (const m of c.models) if (!models.has(m.id)) models.set(m.id, m);
    out[kind] = {
      kind, label: AI_KIND_LABELS[kind], status: best?.status ?? "not_connected",
      ...(best ? (best.reason ? { reason: best.reason } : {}) : { reason: isPersonalKind(kind) ? "Not set up on your Mac" : "Not connected" }),
      ...(best?.resetsAt ? { resetsAt: best.resetsAt } : {}),
      paid: isPaidKind(kind), personal: isPersonalKind(kind), models: [...models.values()], connections: own,
    };
  }
  return out;
}

/** "Provider · model" for a dropdown option. */
export const providerModelLabel = (kind: AiConnectionKind, model: AiModelOption | string) =>
  `${AI_KIND_LABELS[kind]} · ${typeof model === "string" ? model : model.label}`;

/** Models offered for a kind, keeping a saved model that the current list no longer reports. */
export function modelOptions(summary: KindSummary, selected: string | null | undefined): AiModelOption[] {
  if (!selected || summary.models.some(m => m.id === selected)) return summary.models;
  return [...summary.models, { id: selected, label: `${selected} (not reported now)` }];
}

export function moveStep(chain: AiRouteStep[], index: number, delta: -1 | 1): AiRouteStep[] {
  const target = index + delta;
  if (index < 0 || index >= chain.length || target < 0 || target >= chain.length) return chain;
  const next = [...chain];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export const removeStep = (chain: AiRouteStep[], index: number) => chain.filter((_, i) => i !== index);
export const addStep = (chain: AiRouteStep[], kind: AiConnectionKind): AiRouteStep[] =>
  chain.some(s => s.kind === kind) ? chain : [...chain, { kind, model: null }];
export const setStepModel = (chain: AiRouteStep[], index: number, model: string | null) =>
  chain.map((s, i) => (i === index ? { ...s, model: model || null } : s));
export const missingKinds = (chain: AiRouteStep[]) => AI_CONNECTION_KINDS.filter(kind => !chain.some(s => s.kind === kind));
export const defaultChain = (): AiRouteStep[] => DEFAULT_AI_ROUTING.chain.map(s => ({ ...s }));

export type TaskDefaults = AiRoutingSettings["taskDefaults"];
export function setTaskModel(taskDefaults: TaskDefaults, family: AiTaskFamily, kind: AiConnectionKind, model: string | null): TaskDefaults {
  const current = { ...(taskDefaults[family] ?? {}) };
  if (model) current[kind] = model; else delete current[kind];
  const next = { ...taskDefaults };
  if (Object.keys(current).length) next[family] = current; else delete next[family];
  return next;
}

/** The body for PUT /api/studio/ai-routing (chain, per-task models, optimistic version). */
export const routingPayload = (chain: AiRouteStep[], taskDefaults: TaskDefaults, version: number) =>
  ({ chain: chain.map(s => ({ kind: s.kind, model: s.model ?? null })), taskDefaults, version });

export const sameRouting = (a: { chain: AiRouteStep[]; taskDefaults: TaskDefaults }, b: { chain: AiRouteStep[]; taskDefaults: TaskDefaults }) =>
  JSON.stringify(routingPayload(a.chain, a.taskDefaults, 0)) === JSON.stringify(routingPayload(b.chain, b.taskDefaults, 0));

export const formatUsdMicros = (micros: number) => `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`;

/** A reset time in UTC, formatted identically on the server and in the browser. */
export function formatReset(iso: string | undefined): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}
