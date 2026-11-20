import type { StudioDb } from "@/lib/studio/db";
import type { AiRouteStep } from "@/lib/ai/routing";
import { readLocationAiRouting } from "@/lib/ai/routing-store";
import type { CrmRoutePlan, CrmRouteStep } from "@/lib/ai/crm-routing";
import { onboardingServerPlan } from "./providers";

export type OnboardingMacStep = { kind: "device_codex" | "device_claude"; model: string | null; deviceId: string };
export type ResearchRequestOwner = { app: "estio" | "substo"; createdBy: string };
export type OnboardingResearchStep = OnboardingMacStep | CrmRouteStep;

export function chooseResearchSteps(chain: AiRouteStep[], mac: OnboardingMacStep[], server: CrmRouteStep[], remaining?: readonly string[]): OnboardingResearchStep[] {
  return chain.flatMap(({ kind }) => {
    if (remaining && !remaining.includes(kind)) return [];
    const step = mac.find(candidate => candidate.kind === kind) ?? server.find(candidate => candidate.kind === kind);
    return step ? [step] : [];
  });
}

/** Use the same Location order for explicit onboarding research. Server-only jobs without an account retain server routing. */
export async function planOnboardingResearch(studio: StudioDb, locationId: string, owner?: ResearchRequestOwner, remaining?: readonly string[]) {
  const routingOnce = readLocationAiRouting(locationId);
  const [routing, server, mac] = await Promise.all([
    routingOnce,
    routingOnce.then(routing => onboardingServerPlan(locationId, "onboarding_research", routing)),
    owner ? studio.call<OnboardingMacStep[]>("studio_onboarding_mac_routes", {
      p_location_id: locationId, p_actor_app: owner.app, p_clerk_user_id: owner.createdBy,
    }) : Promise.resolve([] as OnboardingMacStep[]),
  ]);
  const steps = chooseResearchSteps(routing.settings.chain, mac, server.steps, remaining);
  const requestedStep = routing.settings.chain.find(s => owner || (s.kind !== "device_codex" && s.kind !== "device_claude"));
  const requested = requestedStep ? { kind: requestedStep.kind,
    model: steps.find(step => step.kind === requestedStep.kind)?.model ?? routing.settings.taskDefaults.research?.[requestedStep.kind] ?? requestedStep.model } : null;
  return { server, steps, requested };
}

export function singleOnboardingServerStep(server: CrmRoutePlan, step: CrmRouteStep, requested: CrmRoutePlan["requested"], switchReason: string | null): CrmRoutePlan {
  return { ...server, steps: [step], requested, switchReason };
}
