import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "../access";
import { canManageStudioAi } from "../ai-settings-policy";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { verifyVoiceKey } from "./clients";
import { keyHint, providerLabels, type HostedVoiceProvider } from "./policy";

/** Fish and ElevenLabs keys are encrypted Location secrets, entered in Settings -> AI like the OpenAI and Gemini keys. Never read from the environment. */
const secretRef = (locationId: string, provider: HostedVoiceProvider) => ({
  scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
  secretKey: provider === "fish" ? SETTINGS_SECRET_KEYS.FISH_API_KEY : SETTINGS_SECRET_KEYS.ELEVENLABS_API_KEY,
});
export class VoiceSettingsError extends Error {}

/** Server-side use only (rendering narration, listing voices). The plaintext never reaches a page, a job payload or the Mac. */
export async function resolveVoiceKey(locationId: string, provider: HostedVoiceProvider): Promise<string | null> {
  if (!locationId.trim()) return null;
  const key = await settingsService.getSecret(secretRef(locationId, provider)).catch(() => null);
  return key?.trim() || null;
}

export async function getVoiceKeySummary(locationId: string): Promise<{ canManage: boolean; keys: Record<HostedVoiceProvider, { keyHint: string; setAt: string } | null> } | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const read = async (provider: HostedVoiceProvider) => {
    const row = await db.settingsSecret.findUnique({ where: { scopeType_scopeId_domain_secretKey: secretRef(access.locationId, provider) }, select: { encryptedAt: true, rotatedAt: true } });
    if (!row) return null;
    const key = await resolveVoiceKey(access.locationId, provider);
    return key ? { keyHint: keyHint(key), setAt: (row.rotatedAt ?? row.encryptedAt).toISOString() } : null;
  };
  const [fish, elevenlabs] = await Promise.all([read("fish"), read("elevenlabs")]);
  return { canManage: canManageStudioAi(access), keys: { fish, elevenlabs } };
}

export async function requireVoiceManager(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor || !canManageStudioAi(access)) throw new VoiceSettingsError("Only a workspace owner or admin, signed in as themselves, can change voice settings.");
  return access;
}
const actorId = async (access: { userId: string; app: "estio" | "substo" }) =>
  (await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } }))?.id ?? null;

export async function saveVoiceKey(locationId: string, provider: HostedVoiceProvider, key: string) {
  const access = await requireVoiceManager(locationId);
  const name = providerLabels[provider];
  const verified = await verifyVoiceKey(provider, key);
  if (verified === "invalid") throw new VoiceSettingsError(`${name} rejected this key. Check it and try again.`);
  if (verified === "unavailable") throw new VoiceSettingsError(`Could not reach ${name} to check this key. Try again shortly.`);
  await settingsService.setSecret({ ...secretRef(access.locationId, provider), plaintext: key.trim(), actorUserId: await actorId(access) });
}
export async function removeVoiceKey(locationId: string, provider: HostedVoiceProvider) {
  const access = await requireVoiceManager(locationId);
  await settingsService.clearSecret({ ...secretRef(access.locationId, provider), actorUserId: await actorId(access) });
}
