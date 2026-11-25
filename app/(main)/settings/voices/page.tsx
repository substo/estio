import { ImageGenerationCard } from "./image-generation";
import { discoverImageModels, getImagePlatformStates, getImageSettings } from "@/lib/studio/images/keys";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { ensureLocalVoices, getVoiceAvailability, listVoices } from "@/lib/studio/voices/service";
import { requireSettingsContext } from "../_components/context";
import { CreateVoice } from "./create-voice";
import { VoiceLibrary } from "./voice-library";
import { GenerationSourcesCard } from "./generation-sources";
import { getGenerationSources, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { getFalKeyHint, soundKeyAvailability } from "@/lib/studio/voices/sound-keys";
import { getSoundModelState } from "@/lib/studio/voices/service";
import { getAvatarState } from "@/lib/studio/avatar";
import { avatarObjectKey } from "@/lib/studio/avatar-policy";
import { createStudioR2Store, readStudioR2Config } from "@/lib/studio/media-r2";
import { YourLookCard } from "./your-look";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voices" };

export default async function VoicesPage() {
  const { locationId, access, tenantHost } = await requireSettingsContext();
  if (tenantHost) notFound();
  if (!locationId || !access) return null;
  const [first, keys, availability, sources, soundChoices, soundKeys, falHint, soundModels] = await Promise.all([listVoices(locationId), getVoiceKeySummary(locationId), getVoiceAvailability(locationId), getGenerationSources(locationId), getSoundProviderChoices(locationId), soundKeyAvailability(locationId), getFalKeyHint(locationId), getSoundModelState(locationId)]);
  const canManage = keys?.canManage === true;
  const avatar = await getAvatarState(locationId);
  const [imagePlatforms, imageSettings] = await Promise.all([getImagePlatformStates(locationId), getImageSettings(locationId)]);
  const [openaiIds, googleIds] = await Promise.all([imagePlatforms.find(p => p.id === "openai")?.hint ? discoverImageModels(locationId, "openai") : [], imagePlatforms.find(p => p.id === "google")?.hint ? discoverImageModels(locationId, "google") : []]);
  const imageDiscovered = { openai: openaiIds, google: googleIds };
  const r2 = readStudioR2Config();
  const photoUrl = avatar && r2 ? await createStudioR2Store(r2).presignRead({ key: avatarObjectKey(locationId, access.userId), contentType: avatar.contentType, contentDisposition: "inline" }).catch(() => null) : null;
  // The on-device speakers need no key: list them the first time an admin opens the page.
  const voices = canManage && !first.some(v => v.provider === "local") ? await ensureLocalVoices(locationId).then(() => listVoices(locationId)).catch(() => first) : first;
  const connected = (["fish", "elevenlabs"] as const).filter(p => keys?.keys[p]);
  return <main className="max-w-3xl space-y-4">
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Voices</h1>
      <p className="text-sm text-muted-foreground">The voices your videos can use. Set a default once; you can still pick another voice for each video. Hosted voices are billed to your own provider account. Keys are in <Link className="text-primary hover:underline" href="/settings/ai">Settings → AI</Link>; the on-device model is in <Link className="text-primary hover:underline" href="/settings/computer">Devices</Link>.</p>
    </div>
    <YourLookCard locationId={locationId} photoUrl={photoUrl} />
    <ImageGenerationCard locationId={locationId} canManage={canManage} platforms={imagePlatforms} choice={imageSettings.choice} tests={imageSettings.tests} discovered={imageDiscovered} />
    <GenerationSourcesCard locationId={locationId} sources={sources} canManage={canManage} hostedKey={{ voice: Boolean(keys?.keys.elevenlabs || keys?.keys.fish), music: soundKeys.fal || soundKeys.elevenlabs, effects: soundKeys.fal || soundKeys.elevenlabs }} sound={{ choices: soundChoices, keys: soundKeys, falHint, models: soundModels }} localVoice={availability.local === "ready"} />
    <VoiceLibrary locationId={locationId} voices={voices} availability={availability} canManage={canManage} connected={[...connected]} />
    {canManage ? <CreateVoice locationId={locationId} providers={[...connected]} local={availability.local} /> : null}
  </main>;
}
