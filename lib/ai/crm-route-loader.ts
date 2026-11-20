import db from "@/lib/db";
import { createStudioDb } from "@/lib/studio/db";
import { loadAiConnections } from "./connections-store";
import { CHATGPT_SUBSCRIPTION_DEFAULT_MODEL } from "./chatgpt-subscription";
import { planCrmRoute, runCrmRoute, type CrmRoutedOperation, type CrmRoutePlan, type CrmRouteStep } from "./crm-routing";
import { GEMINI_FLASH_LATEST_ALIAS } from "./models";
import { OPENAI_DEFAULT_TEXT_MODEL } from "./openai-models";
import { calculateAiCost } from "./pricing-engine";
import { calculateRunCost } from "./pricing";
import { AiRouteUnavailableError, classifyAiAttemptFailure } from "./route-errors";
import { getLocationAiBudget, readLocationAiRouting } from "./routing-store";

const studio = createStudioDb(db);
const MIN_RESERVATION_MICROS = 10_000;
export const CRM_DEFAULT_OUTPUT_TOKENS = 4096;

export async function loadCrmRoutePlan(input: {
  locationId: string; operation?: CrmRoutedOperation; interactive: boolean; hintModel?: string | null; explicitModel?: boolean;
}): Promise<CrmRoutePlan> {
  const [routing, connections] = await Promise.all([readLocationAiRouting(input.locationId), loadAiConnections(input.locationId)]);
  const budget = routing.settings.chain.some(step => step.kind === "openai_key" || step.kind === "gemini_key")
    ? await getLocationAiBudget(input.locationId, studio).catch(() => null)
    : null;
  return planCrmRoute({
    operation: input.operation ?? "crm_text", settings: routing.settings, payload: routing.payload,
    connections: connections.connections ?? [], interactive: input.interactive,
    hintModel: input.hintModel, explicitModel: input.explicitModel,
    budget: budget && { capMicros: budget.capMicros, usedMicros: budget.spentMicros + budget.heldMicros, estimateMicros: MIN_RESERVATION_MICROS },
    defaults: { gemini_key: GEMINI_FLASH_LATEST_ALIAS, openai_key: OPENAI_DEFAULT_TEXT_MODEL, chatgpt_subscription: CHATGPT_SUBSCRIPTION_DEFAULT_MODEL },
  });
}

export async function runLocationCrmRoute<T>(
  plan: CrmRoutePlan,
  locationId: string,
  estimate: { inputChars: number; outputTokens: number },
  execute: (step: CrmRouteStep) => Promise<T>,
  usageOf: (value: T) => { model: string; inputTokens: number; outputTokens: number },
) {
  return runCrmRoute(plan, async (step, route) => {
    if (!step.paid) return execute(step);
    const provider = step.kind === "openai_key" ? "openai" : "google_gemini";
    const cost = async (model: string | null, inputTokens: number, outputTokens: number) => {
      const dollars = await calculateAiCost({ provider, model: model ?? "", locationId, inputTokens, outputTokens });
      const fallback = provider === "google_gemini" && model ? calculateRunCost(model, inputTokens, outputTokens) : 0;
      return Math.ceil((dollars || fallback) * 1_000_000);
    };
    const reservedMicros = Math.max(MIN_RESERVATION_MICROS, await cost(step.model, estimate.inputChars, estimate.outputTokens));
    const usageId = await studio.call<string | null>("studio_reserve_crm_ai_spend", {
      p_location_id: locationId, p_kind: step.kind, p_operation: plan.operation,
      p_estimated_micros: reservedMicros, p_route: route,
    });
    if (!usageId) throw new AiRouteUnavailableError(`${step.label}: monthly cap reached or connection removed from the Location order`);

    let result: T;
    try {
      result = await execute(step);
    } catch (error) {
      if (classifyAiAttemptFailure(error).stage === "before_generation") {
        await studio.call("studio_release_crm_ai_spend", { p_location_id: locationId, p_usage_id: usageId })
          .catch(releaseError => console.error("[CRM AI budget] Failed to release reservation", usageId, releaseError));
      }
      throw error;
    }
    // Unknown provider outcome or failed settlement leaves the hold in place.
    try {
      const usage = usageOf(result);
      const actualMicros = await cost(usage.model, usage.inputTokens, usage.outputTokens);
      await studio.call("studio_settle_crm_ai_spend", {
        p_location_id: locationId, p_usage_id: usageId, p_cost_micros: actualMicros || reservedMicros,
        p_model: usage.model.replace(/^models\//, "").slice(0, 100),
        p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens,
        p_route: { ...route, actual: { kind: step.kind, model: usage.model } },
      });
    } catch (error) {
      console.error("[CRM AI budget] Failed to settle reservation", usageId, error);
    }
    return result;
  });
}
