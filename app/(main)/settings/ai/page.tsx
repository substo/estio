import { notFound } from "next/navigation";
import { LocationAiSettings } from "@/components/ai-settings/location-ai-settings";
import { aiSettingsLinks, loadLocationAiSettings } from "@/components/ai-settings/load";
import { requireSettingsContext } from "../_components/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings" };

export default async function AiSettingsPage() {
  const { app, locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const props = await loadLocationAiSettings(locationId, aiSettingsLinks(app));
  if (!props) notFound();
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <LocationAiSettings {...props} />
  </main>;
}
