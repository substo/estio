import { CONNECTIONS, offersFor } from "@/lib/studio/ai/connections";
import { getConnections } from "@/lib/studio/ai/connections-store";
import { discoverImageModels, getImageSettings } from "@/lib/studio/images/keys";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { ImageActions } from "../_components/image-generation";
import { PlatformStatus } from "../_components/platform-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Images" };

export default async function AiImagesPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [view, settings] = await Promise.all([getConnections(locationId), getImageSettings(locationId)]);
  const connected = Object.fromEntries(view.states.map(s => [s.id, Boolean(s.hint)]));
  const offers = offersFor("images", connected, view.prefs).map(o => ({ model: o.model.id, platform: o.platform }));
  const [openai, google] = await Promise.all([offers.some(o => o.platform === "openai") ? discoverImageModels(locationId, "openai") : [], offers.some(o => o.platform === "google") ? discoverImageModels(locationId, "google") : []]);
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Storyboard images: frames for the beats you have no footage for. {CONNECTIONS.fal.label} alone reaches six models; Midjourney has no official API and is not offered.</p>
    <PlatformStatus capabilities={["images"]} states={view.states} prefs={view.prefs} />
    <ImageActions locationId={locationId} canManage={view.canManage} offers={offers} choice={settings.choice} fallback={settings.fallback} tests={settings.tests} discovered={{ openai, google }} />
  </main>;
}
