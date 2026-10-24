import { queryPath, requestStudioRest, type StudioRestConfig } from "../rest-client";

/** Preflight only; each import RPC must lock and recheck this authority. */
export async function requireStandaloneImportOwner(config: StudioRestConfig, workspaceId: string, ownerId: string,
  error: (code: string) => Error): Promise<void> {
  const workspaces = await requestStudioRest<Array<{ id: string; brand: string; workspace_type: string }>>(config, queryPath("studio_workspaces", {
    select: "id,brand,workspace_type", id: `eq.${workspaceId}`, limit: "1",
  }));
  if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].brand !== "substo" || workspaces[0].workspace_type !== "substo_standalone") throw error("target_is_not_substo_workspace");
  const owners = await requestStudioRest<Array<{ clerk_user_id: string; role: string }>>(config, queryPath("studio_workspace_memberships", {
    select: "clerk_user_id,role", workspace_id: `eq.${workspaceId}`, workspace_brand: "eq.substo", clerk_user_id: `eq.${ownerId}`, role: "eq.owner", limit: "1",
  }));
  if (owners.length !== 1 || owners[0].clerk_user_id !== ownerId || owners[0].role !== "owner") throw error("target_owner_mismatch");
}
