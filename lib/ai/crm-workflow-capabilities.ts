/** Deterministic CRM adapter inventory. Callers supply already-authorized, resolved
 * connection readiness, not secrets or the generic AiConnections.available flag.
 * This does not probe providers or grant access to a Location. */
export type CrmAiSource = "google_api" | "openai_api" | "hosted_subscription";
export type CrmAiWorkflow = "conversation_text" | "website_text" | "live_assistant" | "live_transcription" | "live_translation" | "replay_speech" | "property_image_analysis" | "property_image_generation";
export type ConnectionEvidence = { eligible: boolean; checkedAt?: string; modelListed?: boolean };
const adapters: Record<CrmAiWorkflow, readonly CrmAiSource[]> = {
  conversation_text: ["google_api", "openai_api", "hosted_subscription"],
  website_text: ["google_api", "openai_api", "hosted_subscription"],
  live_assistant: ["hosted_subscription", "google_api", "openai_api"],
  live_transcription: ["google_api", "openai_api"],
  live_translation: ["google_api", "openai_api"],
  replay_speech: ["google_api"],
  property_image_analysis: ["google_api"],
  property_image_generation: ["google_api", "openai_api"],
};
const genericWorkflows: readonly CrmAiWorkflow[] = ["conversation_text", "website_text"];

export function resolveCrmWorkflowCapabilities(input: {
  app: "estio" | "substo";
  workflow: CrmAiWorkflow;
  sources: Partial<Record<CrmAiSource, ConnectionEvidence>>;
}) {
  const allowed = input.app === "estio" || genericWorkflows.includes(input.workflow);
  const routes = adapters[input.workflow].map(source => {
    const evidence = input.sources[source];
    const needsListing = input.workflow === "live_translation";
    const eligible = allowed && evidence?.eligible === true && (!needsListing || evidence.modelListed === true);
    return { source, eligible, evidence: evidence?.eligible ? "connection_eligible" as const : "not_connected" as const,
      modelListed: evidence?.modelListed ?? null, checkedAt: evidence?.checkedAt ?? null };
  });
  return { workflow: input.workflow, allowed, ready: routes.some(route => route.eligible), routes,
    reason: !allowed ? "edition_unavailable" : routes.some(route => route.eligible) ? "connection_eligible" : "workflow_connection_required",
    // Presence, eligibility and model listing are not successful inference or quota checks.
    quota: "unknown" as const, liveAcceptance: "unknown" as const, pairedMac: false as const };
}
