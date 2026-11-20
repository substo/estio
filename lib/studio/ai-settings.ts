import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { canManageStudioAi, keyHint, verifyOpenAiKey } from "./ai-settings-policy";
import { studioDb } from "./studio-db";
import { getLocationAiBudget } from "@/lib/ai/routing-service";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

/** Studio uses the Location's encrypted OpenAI key in settings, the same key the CRM uses. */
const openAiSecret = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY });
async function openAiKeySummary(locationId: string) {
  const row = await db.settingsSecret.findUnique({ where: { scopeType_scopeId_domain_secretKey: openAiSecret(locationId) }, select: { encryptedAt: true, rotatedAt: true } });
  if (!row) return null;
  const key = await settingsService.getSecret(openAiSecret(locationId)).catch(() => null);
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

export async function saveStudioOpenAiKey(locationId: string, key: string) {
  const access = await requireManager(locationId);
  const verified = await verifyOpenAiKey(key);
  if (verified === "invalid") throw new StudioAiSettingsError("OpenAI rejected this key. Check it and try again.");
  if (verified === "unavailable") throw new StudioAiSettingsError("Could not reach OpenAI to check this key. Try again shortly.");
  await settingsService.setSecret({ ...openAiSecret(access.locationId), plaintext: key.trim(), actorUserId: await actorId(access) });
}

export async function removeStudioOpenAiKey(locationId: string) {
  const access = await requireManager(locationId);
  await settingsService.clearSecret({ ...openAiSecret(access.locationId), actorUserId: await actorId(access) });
}

export async function saveStudioAiBudget(locationId: string, monthlyBudgetMicros: number) {
  const access = await requireManager(locationId);
  await studioDb.call("studio_set_ai_budget", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_monthly_budget_micros: monthlyBudgetMicros });
}
