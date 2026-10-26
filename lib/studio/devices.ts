import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { canManageStudioAi } from "./ai-settings-policy";
import { getStudioWorkspaceAccess } from "./access";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { StudioCommandError } from "./command-error";
import { queryPath, studioRest } from "./rest";
import { StudioRestError } from "./rest-client";
import { authorizeEstioSchedule, currentEstioScheduleAuthority } from "./schedule-authority";
import { WORKER_ONLINE_SECONDS } from "./jobs";
import {
  defaultDeviceConfig, formatPairingCode, isAllowedProviderLoginUrl, PAIRING_CODE_ALPHABET, safeDeviceCapabilities,
  type DeviceManagementCommand, type DeviceOperation, type DeviceProvider, type StudioDeviceConfig,
} from "./devices-policy";

export type StudioDeviceStatus = "online" | "busy" | "paused" | "offline" | "revoked";
export interface StudioDeviceCommandSummary {
  id: string; kind: "provider_login" | "provider_logout"; provider: DeviceProvider;
  status: "pending" | "running" | "waiting_for_user" | "succeeded" | "failed" | "cancelled";
  display: { verificationUrl?: string; userCode?: string }; error: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
}
export interface StudioDeviceSummary {
  id: string; name: string; platform: string | null; created_at: string; revoked_at: string | null; last_seen_at: string | null;
  release: string | null; started_at: string | null; allowed_kinds: string[]; capabilities: Record<string, unknown>;
  online: boolean; busy: boolean; status: StudioDeviceStatus; processingEnabled: boolean; paused: boolean;
  /** `value` is the saved setup, or the defaults when nothing was saved yet (version 0). */
  config: { version: number; value: StudioDeviceConfig; appliedVersion: number; status: "none" | "pending" | "applied" | "error";
    report: { unsupported?: Record<string, string>; error?: string } };
  /** Latest command per provider (at most one each). */
  commands: StudioDeviceCommandSummary[];
}
type DeviceRow = Omit<StudioDeviceSummary, "last_seen_at" | "capabilities" | "online" | "busy" | "status" | "processingEnabled" | "paused" | "config" | "commands"> & {
  seen_at: string | null; report: Record<string, unknown>; processing_enabled: boolean; paused: boolean; desired_config: Record<string, unknown>;
  config_version: number; applied_config_version: number; config_status: StudioDeviceSummary["config"]["status"]; config_report: Record<string, unknown>;
};
export const hashStudioDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");

function safeDisplay(value: unknown): StudioDeviceCommandSummary["display"] {
  const d = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ...(isAllowedProviderLoginUrl(d.verificationUrl) ? { verificationUrl: d.verificationUrl } : {}),
    ...(typeof d.userCode === "string" && /^[A-Z0-9-]{4,16}$/.test(d.userCode) ? { userCode: d.userCode } : {}),
  };
}
function safeConfigReport(value: Record<string, unknown>): StudioDeviceSummary["config"]["report"] {
  const out: StudioDeviceSummary["config"]["report"] = {};
  if (value.unsupported && typeof value.unsupported === "object" && !Array.isArray(value.unsupported))
    out.unsupported = Object.fromEntries(Object.entries(value.unsupported).filter(([, reason]) => typeof reason === "string").slice(0, 50)) as Record<string, string>;
  if (typeof value.error === "string") out.error = value.error.slice(0, 300);
  return out;
}

export async function getStudioDevices(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId); if (!access) return null;
  const rows = await studioRest<DeviceRow[]>(queryPath("studio_devices", {
    select: "id,name,platform,created_at,revoked_at,seen_at,release,started_at,allowed_kinds,report,processing_enabled,paused,desired_config,config_version,applied_config_version,config_status,config_report",
    workspace_id: `eq.${access.workspace.id}`, brand: `eq.${access.brand}`, order: "created_at.desc", limit: "100" }));
  const active = rows.filter(row => !row.revoked_at).map(row => row.id);
  const [running, commands] = active.length ? await Promise.all([
    studioRest<Array<{ device_id: string }>>(queryPath("studio_jobs", { select: "device_id", workspace_id: `eq.${access.workspace.id}`,
      device_id: `in.(${active.join(",")})`, status: "eq.running", limit: "100" })),
    studioRest<Array<StudioDeviceCommandSummary & { device_id: string }>>(queryPath("studio_device_commands", {
      select: "id,device_id,kind,provider,status,display,error,created_at,updated_at,finished_at", workspace_id: `eq.${access.workspace.id}`,
      device_id: `in.(${active.join(",")})`, order: "created_at.desc", limit: "200" })),
  ]) : [[], []];
  const busy = new Set(running.map(job => job.device_id));
  const now = Date.now();
  return { canManage: canManageStudioAi(access), devices: rows.map((row): StudioDeviceSummary => {
    const online = !row.revoked_at && row.report.draining !== true && row.seen_at !== null && now - Date.parse(row.seen_at) < WORKER_ONLINE_SECONDS * 1000;
    const status: StudioDeviceStatus = row.revoked_at ? "revoked" : row.paused ? "paused" : !online ? "offline" : busy.has(row.id) ? "busy" : "online";
    const latest: StudioDeviceCommandSummary[] = [];
    for (const { device_id, ...command } of commands) if (device_id === row.id && !latest.some(c => c.provider === command.provider))
      latest.push({ ...command, display: safeDisplay(command.display) });
    const capabilities = safeDeviceCapabilities(row.report);
    return {
      id: row.id, name: row.name, platform: row.platform ?? (typeof capabilities.platform === "string" ? capabilities.platform : null),
      created_at: row.created_at, revoked_at: row.revoked_at, last_seen_at: row.seen_at, release: row.release, started_at: row.started_at,
      allowed_kinds: row.allowed_kinds, capabilities, online, busy: busy.has(row.id), status, processingEnabled: row.processing_enabled, paused: row.paused,
      config: { version: row.config_version, value: row.config_version > 0 ? row.desired_config as unknown as StudioDeviceConfig : defaultDeviceConfig,
        appliedVersion: row.applied_config_version, status: row.config_status, report: safeConfigReport(row.config_report) },
      commands: latest,
    };
  }) };
}

const PAIRING_ACTIONS = { approve_pairing: "approve", deny_pairing: "deny", lookup_pairing: "lookup" } as const;
/** Manager of the active Business (Substo owner/admin or Estio location ADMIN), acting as themselves. */
export async function executeStudioDeviceManagement(workspaceId: string, command: DeviceManagementCommand) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  if (!canManageStudioAi(access)) throw new StudioCommandError("A Business admin is required.", 403);
  const actor = { p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId };
  if (command.action === "approve_pairing" || command.action === "deny_pairing" || command.action === "lookup_pairing") {
    const result = await studioRest<Record<string, unknown>>("rpc/studio_device_pairing_action", { method: "POST", body: JSON.stringify({
      ...actor, p_action: PAIRING_ACTIONS[command.action], p_user_code: command.userCode, p_request_id: "requestId" in command ? command.requestId : null }) });
    return command.action === "deny_pairing" ? { status: "denied" } : result;
  }
  const c = command as Partial<Record<string, unknown>> & DeviceManagementCommand;
  const value = command.action === "set_processing" ? command.enabled : command.action === "set_paused" ? command.paused
    : command.action === "save_config" ? command.config : null;
  return studioRest<Record<string, unknown>>("rpc/studio_manage_device", { method: "POST", body: JSON.stringify({
    ...actor, p_action: command.action, p_request_id: c.requestId ?? null, p_device_id: c.deviceId ?? null,
    p_provider: c.provider ?? null, p_model: c.model ?? null, p_value: value,
    p_expected_version: command.action === "save_config" ? command.expectedVersion : null, p_command_id: c.commandId ?? null }) });
}

/** Estio Business ADMIN lives in Estio's database, so it is re-checked here on every device request. */
const currentEstioAdmin = (userId: string, locationId: string) => currentEstioScheduleAuthority(userId, locationId, "ADMIN");
export async function executeStudioDeviceCommand(token: string, brand: "estio" | "substo", operation: DeviceOperation, body: Record<string, unknown>,
  authorizeEstio = (workspaceId: string, userId: string) => authorizeEstioSchedule(studioRest, workspaceId, userId, currentEstioAdmin)) {
  const tokenHash = hashStudioDeviceToken(token);
  let estioAuthorizedBy: string | null = null;
  if (brand === "estio") {
    const identity = await studioRest<{ workspaceId: string; approvedBy: string } | null>("rpc/studio_device_identity", { method: "POST",
      body: JSON.stringify({ p_token_hash: tokenHash, p_brand: brand }), signal: AbortSignal.timeout(30_000) });
    if (!identity || !await authorizeEstio(identity.workspaceId, identity.approvedBy)) throw new StudioCommandError("Access denied.", 403);
    estioAuthorizedBy = identity.approvedBy;
  }
  return studioRest<unknown>("rpc/studio_device_command", { method: "POST", body: JSON.stringify({
    p_token_hash: tokenHash, p_brand: brand, p_operation: operation, p_body: body, p_estio_authorized_by: estioAuthorizedBy }), signal: AbortSignal.timeout(30_000) });
}

export const PAIRING_POLL_SECONDS = 5;
export function generatePairingCode() { return Array.from({ length: 8 }, () => PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)]).join(""); }
/** Unauthenticated device request. Only hashes of the device code are stored. */
export async function startStudioDevicePairing(brand: "estio" | "substo", origin: string, input: { name: string; platform: string }) {
  const deviceCode = randomBytes(32).toString("base64url");
  for (let attempt = 0; ; attempt++) {
    const userCode = generatePairingCode();
    try {
      const result = await studioRest<{ pairingId: string; userCode: string; expiresAt: string }>("rpc/studio_device_pair_start", { method: "POST", body: JSON.stringify({
        p_brand: brand, p_name: input.name, p_platform: input.platform, p_device_code_hash: hashStudioDeviceToken(deviceCode), p_user_code: userCode }) });
      const display = formatPairingCode(result.userCode);
      return { pairingId: result.pairingId, deviceCode, userCode: display, verificationUrl: `${origin}/studio/settings/computer?code=${display}`,
        expiresAt: result.expiresAt, intervalSeconds: PAIRING_POLL_SECONDS };
    } catch (error) {
      // A user-code collision with another open pairing: draw again.
      if (!(error instanceof StudioRestError && error.code === "23505") || attempt >= 4) throw error;
    }
  }
}
/**
 * The device token is generated per poll but only stored (as a hash) by the first poll after approval,
 * in one transaction. If that response is lost the token is unrecoverable: pair again (the stale device can be revoked).
 */
export async function pollStudioDevicePairing(brand: "estio" | "substo", input: { pairingId: string; deviceCode: string }) {
  const token = `studio_device_${randomBytes(32).toString("base64url")}`;
  const result = await studioRest<{ status: "pending" | "approved" | "denied" | "expired" | "consumed"; deviceId?: string; businessName?: string }>("rpc/studio_device_pair_poll", {
    method: "POST", body: JSON.stringify({ p_brand: brand, p_pairing_id: input.pairingId, p_device_code_hash: hashStudioDeviceToken(input.deviceCode), p_token_hash: hashStudioDeviceToken(token) }) });
  return result.status === "approved" ? { status: "approved" as const, token, deviceId: result.deviceId, businessName: result.businessName } : { status: result.status };
}
