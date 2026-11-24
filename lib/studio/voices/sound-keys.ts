import "server-only";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { keyHint } from "./policy";
import { verifyFalKey } from "./fal-client";
import { requireVoiceManager, resolveVoiceKey, VoiceSettingsError } from "./keys";
import type { SoundKeys } from "./sound-providers";

/** The fal.ai key is an encrypted Location secret like the voice keys, entered in the product and never read from the environment. */
const falRef = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.FAL_API_KEY });

export async function resolveFalKey(locationId: string): Promise<string | null> {
  if (!locationId.trim()) return null;
  const key = await settingsService.getSecret(falRef(locationId)).catch(() => null);
  return key?.trim() || null;
}
/** Which hosted music and effects providers this Location has a key for. */
export async function soundKeyAvailability(locationId: string): Promise<SoundKeys> {
  const [fal, elevenlabs] = await Promise.all([resolveFalKey(locationId), resolveVoiceKey(locationId, "elevenlabs").catch(() => null)]);
  return { fal: Boolean(fal), elevenlabs: Boolean(elevenlabs) };
}
export async function getFalKeyHint(locationId: string): Promise<string | null> {
  const key = await resolveFalKey(locationId);
  return key ? keyHint(key) : null;
}
const actorId = async (access: { userId: string; app: "estio" | "substo" }) =>
  (await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } }))?.id ?? null;
export async function saveFalKey(locationId: string, key: string) {
  const access = await requireVoiceManager(locationId);
  const verified = await verifyFalKey(key);
  if (verified === "invalid") throw new VoiceSettingsError("fal.ai rejected this key. Check it and try again.");
  if (verified === "unavailable") throw new VoiceSettingsError("Could not reach fal.ai to check this key. Try again shortly.");
  await settingsService.setSecret({ ...falRef(access.locationId), plaintext: key.trim(), actorUserId: await actorId(access) });
}
export async function removeFalKey(locationId: string) {
  const access = await requireVoiceManager(locationId);
  await settingsService.clearSecret({ ...falRef(access.locationId), actorUserId: await actorId(access) });
}
