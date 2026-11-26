import { z } from "zod";
import { AI_MODEL_ID_PATTERN, type AiConnection } from "./connections-model";
import {
  AI_CONNECTION_KINDS, AI_ROUTED_OPERATIONS, AI_TASK_FAMILIES, PAID_CONNECTION_KINDS, PERSONAL_CONNECTION_KINDS,
  type AiConnectionKind, type AiRoutedOperation, type AiTaskFamily,
} from "./workflow-capabilities";

/**
 * One Location AI routing model for Estio and Substo (client-safe, pure). The admin orders connections once per Location;
 * every operation takes the first eligible step before generation starts. Stored as `aiRouting` in the Location AI settings
 * document (settings domain `location.ai`). The monthly cap is the Location AI budget (`studio.studio_location_ai_settings`),
 * which the atomic paid reservation reads; it is surfaced here, not copied.
 */
export const AI_ROUTING_VERSION = 1;
const model = z.string().trim().max(120).regex(AI_MODEL_ID_PATTERN, "Use a model id such as gpt-5.5 or sonnet.");
export const aiRouteStepSchema = z.object({ kind: z.enum(AI_CONNECTION_KINDS), model: model.nullish().transform(v => v ?? null) }).strict();
export type AiRouteStep = z.infer<typeof aiRouteStepSchema>;
export const aiRoutingSettingsSchema = z.object({
  version: z.literal(AI_ROUTING_VERSION).default(AI_ROUTING_VERSION),
  chain: z.array(aiRouteStepSchema).max(AI_CONNECTION_KINDS.length)
    .refine(steps => new Set(steps.map(s => s.kind)).size === steps.length, "Each connection can appear once in the order."),
  /** Model per task family and connection kind, e.g. extraction → { device_codex: "gpt-5.5" }. Overrides the step's model. */
  taskDefaults: z.record(z.enum(AI_TASK_FAMILIES), z.record(z.enum(AI_CONNECTION_KINDS), model).default({})).default({}),
}).strict();
export type AiRoutingSettings = z.infer<typeof aiRoutingSettingsSchema>;
/** Until an admin saves an order: own subscriptions, then the Location's hosted ChatGPT. Never a paid API by default. */
export const DEFAULT_AI_ROUTING: AiRoutingSettings = {
  version: AI_ROUTING_VERSION,
  chain: [{ kind: "device_codex", model: null }, { kind: "device_claude", model: null }, { kind: "chatgpt_subscription", model: null }],
  taskDefaults: {},
};
export function readAiRoutingSettings(value: unknown): AiRoutingSettings {
  const parsed = aiRoutingSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AI_ROUTING;
}

export const AI_KIND_LABELS: Record<AiConnectionKind, string> = {
  device_codex: "Codex", device_claude: "Claude", chatgpt_subscription: "Location ChatGPT", openai_key: "OpenAI API", gemini_key: "Gemini API",
};
export type AiRouteBudget = { capMicros: number; usedMicros: number; estimateMicros: number };
export type AiRouteCandidate = { kind: AiConnectionKind; model: string | null; connectionId: string; deviceId?: string; paid: boolean; label: string };
export type AiRouteSkip = { kind: AiConnectionKind; reason: string };
export type AiRouteDecision = {
  operation: AiRoutedOperation;
  /** First step the admin ordered (with its resolved model): what was asked for before any switch. */
  requested: { kind: AiConnectionKind; model: string | null } | null;
  candidates: AiRouteCandidate[];
  skipped: AiRouteSkip[];
  /** Short note when the first candidate is not the requested step, e.g. "Codex limit reached → Claude". */
  switchReason: string | null;
  /** Why nothing can run, when there is no candidate. */
  stopReason: string | null;
};

const modelFor = (step: AiRouteStep, family: AiTaskFamily, taskDefaults: AiRoutingSettings["taskDefaults"], connection: AiConnection) =>
  taskDefaults[family]?.[step.kind] ?? step.model ?? connection.defaultModel;
const capabilityReason = (kind: AiConnectionKind, modality: string, operation: string) =>
  modality !== "text" && !PAID_CONNECTION_KINDS.includes(kind)
    ? `${AI_KIND_LABELS[kind]} can't handle ${modality}`
    : `${AI_KIND_LABELS[kind]} isn't supported for ${operation.replaceAll("_", " ")}`;
const statusReason = (c: AiConnection) => {
  const base = c.reason ?? c.status.replaceAll("_", " ");
  return c.status === "limit_reached" && c.resetsAt ? `${base} (resets ${c.resetsAt})` : base;
};

/**
 * Ordered eligible candidates for one operation, plus why every other step was skipped. Rules: capability first
 * (AI_ROUTED_OPERATIONS); personal steps only on the requester's own Mac and never for background work; paid steps only
 * when in the chain and within the monthly cap; a step's connection must be ready; a Mac-reported model list must contain
 * the chosen model. Admission in SQL rechecks everything atomically.
 */
export function resolveAiRoute(input: {
  operation: AiRoutedOperation; settings: AiRoutingSettings; connections: AiConnection[];
  /** Clerk user id of the person asking; null for background work. */
  requester: { userId: string } | null;
  budget: AiRouteBudget | null;
}): AiRouteDecision {
  const spec = AI_ROUTED_OPERATIONS[input.operation];
  const candidates: AiRouteCandidate[] = [];
  const skipped: AiRouteSkip[] = [];
  const skip = (kind: AiConnectionKind, reason: string) => { skipped.push({ kind, reason }); };
  let requested: AiRouteDecision["requested"] = null;
  for (const step of input.settings.chain) {
    const label = AI_KIND_LABELS[step.kind];
    if (!(spec.kinds as readonly AiConnectionKind[]).includes(step.kind)) { skip(step.kind, capabilityReason(step.kind, spec.modality, input.operation)); continue; }
    const personal = PERSONAL_CONNECTION_KINDS.includes(step.kind);
    if (personal && !input.requester) { skip(step.kind, `${label}: background work can't use a personal subscription`); continue; }
    // Never a teammate's Mac: only connections owned by the requester are considered for personal steps.
    const pool = input.connections.filter(c => c.kind === step.kind && (!personal || c.ownerUserId === input.requester?.userId));
    const firstModel = pool[0] ? modelFor(step, spec.family, input.settings.taskDefaults, pool[0]) : step.model;
    requested ??= { kind: step.kind, model: firstModel ?? null };
    if (!pool.length) { skip(step.kind, personal ? `${label} isn't set up on your Mac` : `${label} isn't connected`); continue; }
    if (PAID_CONNECTION_KINDS.includes(step.kind)) {
      if (!input.budget || input.budget.capMicros <= 0) { skip(step.kind, `${label}: no monthly cap set`); continue; }
      if (input.budget.usedMicros + input.budget.estimateMicros > input.budget.capMicros) { skip(step.kind, `${label}: monthly cap reached`); continue; }
    }
    const ready = pool.filter(c => c.status === "ready").sort((a, b) => (b.remainingPercent ?? 50) - (a.remainingPercent ?? 50));
    if (!ready.length) { const why = statusReason(pool[0]); skip(step.kind, why.startsWith(label) ? why : `${label}: ${why.charAt(0).toLowerCase()}${why.slice(1)}`); continue; }
    const connection = ready[0];
    const chosen = modelFor(step, spec.family, input.settings.taskDefaults, connection);
    if (chosen && connection.modelsSource === "reported" && !connection.models.some(m => m.id === chosen)) { skip(step.kind, `${label}: model ${chosen} isn't available`); continue; }
    candidates.push({ kind: step.kind, model: chosen ?? null, connectionId: connection.id, ...(connection.deviceId ? { deviceId: connection.deviceId } : {}), paid: connection.paid, label });
  }
  const first = candidates[0];
  const switched = first && requested && (requested.kind !== first.kind) ? skipped.find(s => s.kind === requested!.kind) : undefined;
  return {
    operation: input.operation, requested, candidates, skipped,
    switchReason: switched && first ? `${switched.reason} → ${first.label}` : null,
    stopReason: first ? null : !input.settings.chain.length ? "No AI connections are ordered for this Location." : skipped.map(s => s.reason).join("; "),
  };
}

/** Where a failed attempt stands. Only `before_generation` (capacity/limit/admission, or a provider 429/quota rejection before output) may move on. */
export type AiAttemptFailure = { stage: "before_generation" | "started" | "uncertain"; reason: string };
/**
 * The next candidate after a failure, or a stop. A run that already started, or whose outcome is uncertain, is never
 * replayed automatically on any step (the existing replay fences stay authoritative).
 */
export function nextAiRoute(decision: AiRouteDecision, current: AiConnectionKind, failure: AiAttemptFailure):
  { next: AiRouteCandidate; switchReason: string } | { next: null; stopReason: string } {
  if (failure.stage !== "before_generation") return { next: null, stopReason: "This run already started, so it isn't replayed automatically. Start a new request." };
  const index = decision.candidates.findIndex(c => c.kind === current);
  const next = index >= 0 ? decision.candidates[index + 1] : undefined;
  if (!next) return { next: null, stopReason: `${failure.reason}; no further step in this Location's order can run it` };
  return { next, switchReason: `${failure.reason} → ${next.label}` };
}

/** One plain sentence for the UI: which route will run and, when it is not the first choice, why. Null when nothing runs. */
export function describeTextRoute(decision: AiRouteDecision): string | null {
  const step = decision.candidates[0];
  if (!step) return null;
  const via = step.kind === "device_codex" || step.kind === "device_claude" ? `${step.label} on your Mac` : `${step.label}${step.paid ? " (paid)" : ""}`;
  const asked = decision.requested;
  if (!asked || asked.kind === step.kind) return `Using ${via}${step.model ? ` · ${step.model}` : ""}.`;
  const why = decision.skipped.find(s => s.kind === asked.kind)?.reason ?? `${AI_KIND_LABELS[asked.kind]} isn't available`;
  const label = AI_KIND_LABELS[asked.kind];
  const clean = (why.toLowerCase().startsWith(label.toLowerCase()) ? why.slice(label.length).replace(/^:?\s*/, "") : why).replace(/\s*\(resets[^)]*\)/, "");
  return `${AI_KIND_LABELS[asked.kind]}: ${clean.charAt(0).toLowerCase()}${clean.slice(1)}. Using ${via}${step.model ? ` · ${step.model}` : ""} instead.`;
}

