import type { AiConnection } from "./connections-model";
import { AiRouteUnavailableError, classifyAiAttemptFailure } from "./route-errors";
import { AI_KIND_LABELS, nextAiRoute, resolveAiRoute, type AiRouteBudget, type AiRouteDecision, type AiRouteSkip, type AiRoutingSettings } from "./routing";
import { AI_ROUTED_OPERATIONS, type AiConnectionKind, type AiTaskFamily } from "./workflow-capabilities";

/**
 * CRM server-side routing over the one Location chain (pure; lib/ai/routing.ts decides eligibility). Server adapters run
 * the Location's hosted ChatGPT, OpenAI key and Gemini key. No CRM call runs on a Mac, so the chain's Codex step is filled,
 * for interactive work only, by the requester's own ChatGPT login (same subscription family, never a teammate's); the
 * Claude step is skipped. Audio, realtime and image adapters are not routed here.
 */
export const CRM_ROUTED_OPERATIONS = ["crm_text", "crm_translation", "crm_extraction", "crm_summary", "onboarding_answer", "onboarding_research"] as const;
export type CrmRoutedOperation = typeof CRM_ROUTED_OPERATIONS[number];
const SERVER_KINDS: readonly AiConnectionKind[] = ["chatgpt_subscription", "openai_key", "gemini_key"];
export const PERSONAL_CHATGPT_LABEL = "Your ChatGPT";

const OPENAI_PREFIX = "openai:";
const CHATGPT_PREFIX = "chatgpt_subscription:";
/** Which connection a stored model value belongs to: `openai:…`, `chatgpt_subscription:…`, otherwise a Gemini model. */
export function modelKind(modelId: string): AiConnectionKind {
  const value = String(modelId || "").trim();
  return value.startsWith(OPENAI_PREFIX) ? "openai_key" : value.startsWith(CHATGPT_PREFIX) ? "chatgpt_subscription" : "gemini_key";
}
export const bareModel = (modelId: string) => String(modelId || "").trim().replace(/^(openai:|chatgpt_subscription:)/, "");

/**
 * Migration defaults: the per-task model fields CRM Locations saved before the chain existed. Each value may name an
 * OpenAI or ChatGPT model by prefix, so it maps onto `taskDefaults[family][kind]`. A saved task model always wins.
 * Transcription keeps its own field (audio is operation-specific, not chain-routed).
 */
export const LEGACY_TASK_MODEL_FIELDS: Record<AiTaskFamily, readonly string[]> = {
  text: ["googleAiModel"],
  extraction: ["googleAiModelExtraction", "googleAiModel"],
  translation: ["googleAiModelTranslation", "googleAiModelDesign", "googleAiModel"],
  summaries: ["googleAiModel"],
  research: ["googleAiModelExtraction", "googleAiModel"],
};
export function legacyTaskModels(payload: Record<string, unknown> | null | undefined, family: AiTaskFamily): Partial<Record<AiConnectionKind, string>> {
  const out: Partial<Record<AiConnectionKind, string>> = {};
  for (const field of LEGACY_TASK_MODEL_FIELDS[family]) {
    const value = typeof payload?.[field] === "string" ? String(payload[field]).trim() : "";
    if (value && !out[modelKind(value)]) out[modelKind(value)] = bareModel(value);
  }
  const openAi = typeof payload?.openAiTextModel === "string" ? bareModel(payload.openAiTextModel) : "";
  if (openAi && !out.openai_key) out.openai_key = openAi;
  return out;
}

export type CrmRouteStep = { kind: AiConnectionKind; model: string | null; label: string; personal: boolean; paid: boolean };
export type CrmRoutePlan = {
  operation: CrmRoutedOperation;
  family: AiTaskFamily;
  requested: { kind: AiConnectionKind; model: string | null } | null;
  steps: CrmRouteStep[];
  skipped: AiRouteSkip[];
  switchReason: string | null;
  stopReason: string | null;
};
/** What traces and usage rows record: what was asked for, what ran, and why it differs. */
export type CrmRouteRecord = {
  operation: CrmRoutedOperation;
  requested: { kind: AiConnectionKind; model: string | null } | null;
  actual: { kind: AiConnectionKind; model: string | null };
  switchReason: string | null;
};

export function planCrmRoute(input: {
  operation: CrmRoutedOperation;
  settings: AiRoutingSettings;
  /** The Location AI settings document, for the legacy per-task fields. */
  payload?: Record<string, unknown> | null;
  connections: AiConnection[];
  interactive: boolean;
  budget: AiRouteBudget | null;
  /** The caller's model value (legacy per-task field or a request's pick). Used only on its own connection kind. */
  hintModel?: string | null;
  /** The requester picked this model for this request: it beats the Location's task model on its own kind. */
  explicitModel?: boolean;
  /** Built-in model per kind when nothing is configured. */
  defaults?: Partial<Record<AiConnectionKind, string>>;
}): CrmRoutePlan {
  const { operation } = input;
  const family = AI_ROUTED_OPERATIONS[operation].family;
  const hint = String(input.hintModel || "").trim();
  const hintKind = hint ? modelKind(hint) : null;
  const legacy = legacyTaskModels(input.payload, family);
  const chain = input.settings.chain;
  const capableKinds: readonly AiConnectionKind[] = AI_ROUTED_OPERATIONS[operation].kinds;
  const connections = input.connections.filter(connection => connection.scope !== "device");
  const personalSlot = input.interactive && operation.startsWith("crm_") && capableKinds.includes("device_codex");
  if (personalSlot) {
    // The server executor checks active membership and resolves only this requester's credential.
    connections.push({
      id: "personal_chatgpt", kind: "device_codex", scope: "location", label: PERSONAL_CHATGPT_LABEL,
      ownerUserId: "crm-requester", status: "ready", paid: false, models: [], modelsSource: "curated", defaultModel: null,
    });
  }
  const decision = resolveAiRoute({
    operation, settings: input.settings, connections,
    requester: personalSlot ? { userId: "crm-requester" } : null, budget: input.budget,
  });
  const taskModels = input.settings.taskDefaults[family] ?? {};
  const pick = (kind: AiConnectionKind, stepModel: string | null): string | null => {
    const hinted = hint && hintKind === kind ? bareModel(hint) : null;
    const connectionDefault = input.connections.find(c => c.kind === kind && c.scope !== "device")?.defaultModel ?? null;
    if (kind === "device_codex") return (input.explicitModel && hint && hintKind === "chatgpt_subscription" ? bareModel(hint) : null) ?? taskModels.device_codex ?? stepModel ?? null;
    // Built-in defaults beat a catalog's first entry, which is not curated for text.
    const migrationDefault = family === "translation" ? legacy[kind] ?? hinted : hinted ?? legacy[kind];
    return (input.explicitModel ? hinted : null) ?? taskModels[kind] ?? stepModel ?? migrationDefault ?? input.defaults?.[kind] ?? connectionDefault ?? null;
  };

  const steps: CrmRouteStep[] = decision.candidates
    .filter(candidate => candidate.kind === "device_codex" || SERVER_KINDS.includes(candidate.kind))
    .map(candidate => {
      const personal = candidate.kind === "device_codex";
      const configured = chain.find(step => step.kind === candidate.kind);
      return { kind: candidate.kind, model: pick(candidate.kind, configured?.model ?? null),
        label: personal ? PERSONAL_CHATGPT_LABEL : candidate.label, personal, paid: candidate.paid };
    });
  const requestedStep = chain.find(step => capableKinds.includes(step.kind) && (step.kind !== "device_codex" || personalSlot));
  const requested = requestedStep ? { kind: requestedStep.kind, model: pick(requestedStep.kind, requestedStep.model) } : null;
  const skipped = decision.skipped.map(skip => skip.kind === "device_claude"
    ? { kind: skip.kind, reason: `${AI_KIND_LABELS[skip.kind]}: CRM requests don't run on a Mac` }
    : skip);
  const first = steps[0];
  const switched = first && requested && requested.kind !== first.kind ? skipped.find(s => s.kind === requested!.kind) : undefined;
  return {
    operation, family, requested, steps, skipped,
    switchReason: switched && first ? `${switched.reason} → ${first.label}` : null,
    stopReason: first ? null : !chain.length ? "No AI connections are ordered for this Location." : skipped.map(s => s.reason).join("; ") || "No AI connection in this Location's order can run this.",
  };
}

/**
 * Run a plan: the first step, then the next only when the failure is known to precede generation (limit, quota,
 * credential or connection unavailable). A started or uncertain attempt rethrows and is never replayed (nextAiRoute).
 */
export async function runCrmRoute<T>(plan: CrmRoutePlan, execute: (step: CrmRouteStep, route: CrmRouteRecord) => Promise<T>): Promise<{ value: T; step: CrmRouteStep; route: CrmRouteRecord }> {
  if (!plan.steps.length) throw new AiRouteUnavailableError(`No AI connection in this Location's order can run this now: ${plan.stopReason ?? "none is ready"}.`);
  const decision: AiRouteDecision = { operation: plan.operation, requested: plan.requested, skipped: plan.skipped,
    stopReason: plan.stopReason, switchReason: plan.switchReason,
    candidates: plan.steps.map(step => ({ ...step, connectionId: step.kind })) };
  let switchReason = plan.switchReason;
  let index = 0;
  while (true) {
    const step = plan.steps[index];
    try {
      const route = { operation: plan.operation, requested: plan.requested, actual: { kind: step.kind, model: step.model }, switchReason };
      const value = await execute(step, route);
      return { value, step, route };
    } catch (error) {
      const next = nextAiRoute(decision, step.kind, classifyAiAttemptFailure(error));
      if (!next.next) throw error;
      switchReason = next.switchReason;
      index = plan.steps.findIndex(s => s.kind === next.next!.kind);
    }
  }
}
