import { CONNECTIONS, offersFor } from "@/lib/studio/ai/connections";
import { aiSettingsLinks, loadLocationAiSettings } from "@/components/ai-settings/load";
import { getConnections } from "@/lib/studio/ai/connections-store";
import { discoverImageModels, getImageSettings } from "@/lib/studio/images/keys";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { ImageActions, type ImageOffer } from "../_components/image-generation";
import { PlatformStatus } from "../_components/platform-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Images" };

export default async function AiImagesPage() {
  const { app, locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [view, settings, ai] = await Promise.all([getConnections(locationId), getImageSettings(locationId), loadLocationAiSettings(locationId, aiSettingsLinks(app)).catch(() => null)]);
  const codexReady = Boolean(ai?.routing.connections.some(c => c.kind === "device_codex" && c.status === "ready"));
  const connected = Object.fromEntries(view.states.map(s => [s.id, Boolean(s.hint)]));
  const offers: ImageOffer[] = [...(codexReady ? [{ model: "codex-imagegen", platform: "codex" as const }] : []), ...offersFor("images", connected, view.prefs).map(o => ({ model: o.model.id, platform: o.platform as ImageOffer["platform"] }))];
  const [openai, google] = await Promise.all([offers.some(o => o.platform === "openai") ? discoverImageModels(locationId, "openai") : [], offers.some(o => o.platform === "google") ? discoverImageModels(locationId, "google") : []]);
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Storyboard images: frames for the beats you have no footage for. Your ChatGPT subscription (Codex on your Mac) draws frames at no extra cost when the Mac is on; {CONNECTIONS.fal.label} alone reaches six more models; Midjourney has no official API and is not offered.</p>
    <PlatformStatus capabilities={["images"]} states={view.states} prefs={view.prefs} />
    <ImageActions locationId={locationId} canManage={view.canManage} offers={offers} choice={settings.choice} fallback={settings.fallback} tests={settings.tests} discovered={{ openai, google }} />
  </main>;
}
