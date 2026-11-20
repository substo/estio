import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { canManageStudioAi, keyHint, verifyLocationAiKey, type LocationAiKeyProvider } from "./ai-settings-policy";
import { studioDb } from "./studio-db";
import { getLocationAiBudget } from "@/lib/ai/routing-service";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

/** Studio uses the Location's encrypted OpenAI key in settings, the same key the CRM uses. */
const locationAiSecret = (locationId: string, provider: LocationAiKeyProvider) => ({
  scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
  secretKey: provider === "gemini" ? SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY : SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
});
async function openAiKeySummary(locationId: string) {
  const row = await db.settingsSecret.findUnique({ where: { scopeType_scopeId_domain_secretKey: locationAiSecret(locationId, "openai") }, select: { encryptedAt: true, rotatedAt: true } });
  if (!row) return null;
  const key = await settingsService.getSecret(locationAiSecret(locationId, "openai")).catch(() => null);
  return key ? { keyHint: keyHint(key), setAt: (row.rotatedAt ?? row.encryptedAt).toISOString() } : null;
}

export class StudioAiSettingsError extends Error {}

/** Read-only summary for any workspace member; the key itself is never returned. Budget is the shared Location AI cap. */
export async function getStudioAiSettings(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const [openai, budget] = await Promise.all([openAiKeySummary(access.locationId), getLocationAiBudget(access.locationId)]);
  return { access, canManage: canManageStudioAi(access), encryptionReady: true,
    openai,
    monthlyBudgetMicros: budget.capMicros, spentMicros: budget.spentMicros, heldMicros: budget.heldMicros };
}

async function requireManager(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor || !canManageStudioAi(access)) throw new StudioAiSettingsError("Only a workspace owner or admin, signed in as themselves, can change AI settings.");
  return access;
}

async function actorId(access: { userId: string; app: "estio" | "substo" }) {
  const user = await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } });
  return user?.id ?? null;
}

export async function saveStudioAiKey(locationId: string, provider: LocationAiKeyProvider, key: string) {
  const access = await requireManager(locationId);
  const verified = await verifyLocationAiKey(provider, key);
  const name = provider === "gemini" ? "Gemini" : "OpenAI";
  if (verified === "invalid") throw new StudioAiSettingsError(`${name} rejected this key. Check it and try again.`);
  if (verified === "unavailable") throw new StudioAiSettingsError(`Could not reach ${name} to check this key. Try again shortly.`);
  await settingsService.setSecret({ ...locationAiSecret(access.locationId, provider), plaintext: key.trim(), actorUserId: await actorId(access) });
}

export async function removeStudioAiKey(locationId: string, provider: LocationAiKeyProvider) {
  const access = await requireManager(locationId);
  await settingsService.clearSecret({ ...locationAiSecret(access.locationId, provider), actorUserId: await actorId(access) });
}

export async function saveStudioAiBudget(locationId: string, monthlyBudgetMicros: number) {
  const access = await requireManager(locationId);
  await studioDb.call("studio_set_ai_budget", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_monthly_budget_micros: monthlyBudgetMicros });
}
