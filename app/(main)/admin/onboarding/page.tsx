import { redirect } from "next/navigation";
import { getLocationContext } from "@/lib/auth/location-context";
import { OnboardingPage } from "@/components/onboarding/onboarding-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business profile" };

/** Business onboarding inside the CRM shell (both apps). ?update=1 comes from Settings. */
export default async function CrmOnboardingPage({ searchParams }: { searchParams: Promise<{ update?: string }> }) {
  const location = await getLocationContext();
  if (!location?.id) redirect("/select-location");
  return <OnboardingPage locationId={location.id} homeHref="/admin" updateMode={(await searchParams).update === "1"} />;
}
