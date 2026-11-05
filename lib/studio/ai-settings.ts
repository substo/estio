import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { canManageStudioAi, keyHint, verifyOpenAiKey } from "./ai-settings-policy";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
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

function currentMonth() { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; }

/** Read-only summary for any workspace member; the key itself is never returned. */
export async function getStudioAiSettings(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const workspace = access.locationId;
  const [openai, settings, usage] = await Promise.all([
    openAiKeySummary(workspace),
    studioDb.rows<{ monthly_budget_micros: number }>(Prisma.sql`
      select monthly_budget_micros from studio.studio_location_ai_settings where location_id = ${workspace} limit 1`),
    studioDb.one<{ spent: number; held: number }>(Prisma.sql`
      select coalesce(sum(cost_micros) filter (where status = 'settled'), 0) as spent,
        coalesce(sum(reserved_micros) filter (where status = 'reserved'), 0) as held
      from studio.studio_ai_usage where location_id = ${workspace} and usage_month = ${currentMonth()}::date
      and status in ('reserved', 'settled')`),
  ]);
  const spent = Number(usage?.spent ?? 0);
  const held = Number(usage?.held ?? 0);
  return { access, canManage: canManageStudioAi(access), encryptionReady: true,
    openai,
    monthlyBudgetMicros: Number(settings[0]?.monthly_budget_micros ?? 0), spentMicros: spent, heldMicros: held };
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
