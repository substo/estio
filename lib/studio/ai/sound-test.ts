import "server-only";
import { requireVoiceManager, resolveVoiceKey } from "../voices/keys";
import { resolveFalKey } from "../voices/sound-keys";
import { generateHostedSound, soundErrorMessage } from "../voices/sound-render";
import type { HostedSoundProvider, SoundKind } from "../voices/sound-providers";

/** One short clip from the chosen hosted provider so a key and a model are proven by sound. Costs a cent or two, only when the owner presses Test. */
export async function testSound(locationId: string, kind: SoundKind, provider: HostedSoundProvider): Promise<{ ok: boolean; message: string; ms: number; dataUrl?: string }> {
  await requireVoiceManager(locationId);
  const key = provider === "fal" ? await resolveFalKey(locationId) : await resolveVoiceKey(locationId, "elevenlabs");
  if (!key) return { ok: false, message: `Connect ${provider === "fal" ? "fal.ai" : "ElevenLabs"} first.`, ms: 0 };
  const started = Date.now();
  try {
    const audio = await generateHostedSound(provider, kind, key, kind === "music" ? 6 : 2);
    return { ok: true, message: "Made a test clip.", ms: Date.now() - started, dataUrl: `data:audio/mpeg;base64,${audio.toString("base64")}` };
  } catch (error) { return { ok: false, message: soundErrorMessage(error) ?? "The test failed.", ms: Date.now() - started }; }
}
