import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { discoverImageModels, getImagePlatformStates, getImageSettings } from "@/lib/studio/images/keys";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { ImageGenerationCard } from "../_components/image-generation";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Images" };

export default async function AiImagesPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [keys, platforms, settings] = await Promise.all([getVoiceKeySummary(locationId), getImagePlatformStates(locationId), getImageSettings(locationId)]);
  const [openai, google] = await Promise.all([platforms.find(p => p.id === "openai")?.hint ? discoverImageModels(locationId, "openai") : [], platforms.find(p => p.id === "google")?.hint ? discoverImageModels(locationId, "google") : []]);
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <ImageGenerationCard locationId={locationId} canManage={keys?.canManage === true} platforms={platforms} choice={settings.choice} tests={settings.tests} discovered={{ openai, google }} />
  </main>;
}
