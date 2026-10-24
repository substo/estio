import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { canManageStudioAi, keyHint, verifyOpenAiKey } from "./ai-settings-policy";
import { queryPath, studioRest } from "./rest";
import { aiCredentialContext, encryptStudioSecret, hasStudioSecretsKey } from "./secrets";

export class StudioAiSettingsError extends Error {}

function currentMonth() { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; }

/** Read-only summary for any workspace member; the key itself is never returned. */
export async function getStudioAiSettings(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const workspace = access.workspace.id;
  const [credentials, settings, usage] = await Promise.all([
    studioRest<Array<{ provider: string; key_hint: string; set_at: string }>>(queryPath("studio_workspace_ai_credentials", {
      select: "provider,key_hint,set_at", workspace_id: `eq.${workspace}`, provider: "eq.openai", limit: "1" })),
    studioRest<Array<{ monthly_budget_micros: number }>>(queryPath("studio_workspace_ai_settings", {
      select: "monthly_budget_micros", workspace_id: `eq.${workspace}`, limit: "1" })),
    studioRest<Array<{ status: string; reserved_micros: number; cost_micros: number | null }>>(queryPath("studio_ai_usage", {
      select: "status,reserved_micros,cost_micros", workspace_id: `eq.${workspace}`, usage_month: `eq.${currentMonth()}`, status: "in.(reserved,settled)", limit: "10000" })),
  ]);
  const spent = usage.reduce((sum, row) => sum + (row.status === "settled" ? Number(row.cost_micros) : 0), 0);
  const held = usage.reduce((sum, row) => sum + (row.status === "reserved" ? Number(row.reserved_micros) : 0), 0);
  return { access, canManage: canManageStudioAi(access), encryptionReady: hasStudioSecretsKey(),
    openai: credentials[0] ? { keyHint: credentials[0].key_hint, setAt: credentials[0].set_at } : null,
    monthlyBudgetMicros: Number(settings[0]?.monthly_budget_micros ?? 0), spentMicros: spent, heldMicros: held };
}

async function requireManager(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (await auth()).actor || !canManageStudioAi(access)) throw new StudioAiSettingsError("Only a workspace owner or admin, signed in as themselves, can change AI settings.");
  return access;
}

export async function saveStudioOpenAiKey(workspaceId: string, key: string) {
  const access = await requireManager(workspaceId);
  if (!hasStudioSecretsKey()) throw new StudioAiSettingsError("Secure key storage is not configured on this server yet.");
  const verified = await verifyOpenAiKey(key);
  if (verified === "invalid") throw new StudioAiSettingsError("OpenAI rejected this key. Check it and try again.");
  if (verified === "unavailable") throw new StudioAiSettingsError("Could not reach OpenAI to check this key. Try again shortly.");
  const sealed = encryptStudioSecret(key, aiCredentialContext(access.workspace.id, "openai"));
  await studioRest("rpc/studio_set_ai_credential", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_provider: "openai",
    p_ciphertext: sealed.ciphertext, p_iv: sealed.iv, p_auth_tag: sealed.authTag, p_key_id: sealed.keyId, p_key_hint: keyHint(key) }) });
}

export async function removeStudioOpenAiKey(workspaceId: string) {
  const access = await requireManager(workspaceId);
  await studioRest("rpc/studio_clear_ai_credential", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_provider: "openai" }) });
}

export async function saveStudioAiBudget(workspaceId: string, monthlyBudgetMicros: number) {
  const access = await requireManager(workspaceId);
  await studioRest("rpc/studio_set_ai_budget", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_monthly_budget_micros: monthlyBudgetMicros }) });
}
