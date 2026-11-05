import { notFound } from "next/navigation";
import { getOnboardingView } from "@/lib/onboarding/service";
import { onboardingActor } from "@/lib/onboarding/actor";
import { connectLinks } from "@/lib/onboarding/entry";
import { OnboardingScreen } from "./onboarding-screen";

/** Server part of the shared onboarding screen; the CRM and Studio routes render it inside their own shell. */
export async function OnboardingPage({ locationId, homeHref, updateMode }: { locationId: string; homeHref: string; updateMode: boolean }) {
  const actor = await onboardingActor(locationId);
  if (!actor) notFound();
  const view = await getOnboardingView(actor);
  return <OnboardingScreen initialView={view} locationId={locationId} connect={connectLinks(actor.app)} homeHref={homeHref} updateMode={updateMode} />;
}
