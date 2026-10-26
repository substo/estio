import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { canManageStudioAi } from "./ai-settings-policy";
import { getStudioWorkspaceAccess } from "./access";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { StudioCommandError } from "./command-error";
import { queryPath, studioRest } from "./rest";
import { safeDeviceCapabilities, type DeviceManagementCommand, type DeviceOperation } from "./devices-policy";
export interface StudioDeviceSummary {
  id: string; name: string; created_at: string; revoked_at: string | null; last_seen_at: string | null;
  release: string | null; started_at: string | null; allowed_kinds: string[]; capabilities: Record<string, unknown>;
}
export const hashStudioDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function getStudioDevices(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId); if (!access) return null;
  const rows = await studioRest<Array<Omit<StudioDeviceSummary, "last_seen_at" | "capabilities"> & { seen_at: string | null; report: Record<string, unknown> }>>(queryPath("studio_devices", {
    select: "id,name,created_at,revoked_at,seen_at,release,started_at,allowed_kinds,report", workspace_id: `eq.${access.workspace.id}`, brand: `eq.${access.brand}`, order: "created_at.desc", limit: "100" }));
  return { canManage: access.brand === "substo" && canManageStudioAi(access), devices: rows.map(({ seen_at, report, ...row }): StudioDeviceSummary => ({ ...row, last_seen_at: seen_at, capabilities: safeDeviceCapabilities(report) })) };
}
export async function executeStudioDeviceManagement(workspaceId: string, command: DeviceManagementCommand) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  if (access.brand !== "substo" || !canManageStudioAi(access)) throw new StudioCommandError("A Business admin is required.", 403);
  const token = command.action === "create" ? `studio_device_${randomBytes(32).toString("base64url")}` : null;
  const result = await studioRest<{ deviceId: string } | { jobId: string }>("rpc/studio_manage_device", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId,
    p_action: command.action, p_request_id: command.requestId, p_name: command.name ?? null, p_device_id: command.deviceId ?? null,
    p_token_hash: token ? hashStudioDeviceToken(token) : null, p_provider: command.provider ?? null, p_model: command.model ?? null }) });
  return token ? { ...result, token } : result;
}
export function executeStudioDeviceCommand(token: string, brand: "estio" | "substo", operation: DeviceOperation, body: Record<string, unknown>) {
  return studioRest<unknown>("rpc/studio_device_command", { method: "POST", body: JSON.stringify({ p_token_hash: hashStudioDeviceToken(token), p_brand: brand, p_operation: operation, p_body: body }), signal: AbortSignal.timeout(30_000) });
}
