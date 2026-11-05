import { studioRouteParams } from "@/lib/studio/route-context";
import { OnboardingPage } from "@/components/onboarding/onboarding-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business profile" };

/** Business onboarding inside the Studio shell; replaces Studio's former brand wizard. ?update=1 comes from Settings. */
export default async function StudioOnboardingPage({ params, searchParams }: { params: Promise<{}>; searchParams: Promise<{ update?: string }> }) {
  const { locationId } = await studioRouteParams(params);
  return <OnboardingPage locationId={locationId} homeHref="/studio" updateMode={(await searchParams).update === "1"} />;
}
