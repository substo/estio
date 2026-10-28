import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { canManageStudioAi, keyHint, verifyOpenAiKey } from "./ai-settings-policy";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import { aiCredentialContext, encryptStudioSecret, hasStudioSecretsKey } from "./secrets";

export class StudioAiSettingsError extends Error {}

function currentMonth() { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; }

/** Read-only summary for any workspace member; the key itself is never returned. */
export async function getStudioAiSettings(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const workspace = access.locationId;
  const [credentials, settings, usage] = await Promise.all([
    studioDb.rows<{ provider: string; key_hint: string; set_at: string }>(Prisma.sql`
      select provider, key_hint, set_at from studio.studio_location_ai_credentials
      where location_id = ${workspace} and provider = 'openai' limit 1`),
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
  return { access, canManage: canManageStudioAi(access), encryptionReady: hasStudioSecretsKey(),
    openai: credentials[0] ? { keyHint: credentials[0].key_hint, setAt: credentials[0].set_at } : null,
    monthlyBudgetMicros: Number(settings[0]?.monthly_budget_micros ?? 0), spentMicros: spent, heldMicros: held };
}

async function requireManager(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor || !canManageStudioAi(access)) throw new StudioAiSettingsError("Only a workspace owner or admin, signed in as themselves, can change AI settings.");
  return access;
}

export async function saveStudioOpenAiKey(locationId: string, key: string) {
  const access = await requireManager(locationId);
  if (!hasStudioSecretsKey()) throw new StudioAiSettingsError("Secure key storage is not configured on this server yet.");
  const verified = await verifyOpenAiKey(key);
  if (verified === "invalid") throw new StudioAiSettingsError("OpenAI rejected this key. Check it and try again.");
  if (verified === "unavailable") throw new StudioAiSettingsError("Could not reach OpenAI to check this key. Try again shortly.");
  const sealed = encryptStudioSecret(key, aiCredentialContext(access.locationId, "openai"));
  await studioDb.call("studio_set_ai_credential", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_provider: "openai",
    p_ciphertext: sealed.ciphertext, p_iv: sealed.iv, p_auth_tag: sealed.authTag, p_key_id: sealed.keyId, p_key_hint: keyHint(key) });
}

export async function removeStudioOpenAiKey(locationId: string) {
  const access = await requireManager(locationId);
  await studioDb.call("studio_clear_ai_credential", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_provider: "openai" });
}

export async function saveStudioAiBudget(locationId: string, monthlyBudgetMicros: number) {
  const access = await requireManager(locationId);
  await studioDb.call("studio_set_ai_budget", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_monthly_budget_micros: monthlyBudgetMicros });
}
