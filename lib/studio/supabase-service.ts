import "server-only";
import { cache } from "react";
import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { queryPath, studioRest, studioRestAll } from "./rest";

type WorkspaceBrand = "estio" | "substo";
type WorkspaceType = "estio_location" | "substo_standalone";

export interface StudioWorkspace {
  id: string;
  brand: WorkspaceBrand;
  workspace_type: WorkspaceType;
  name: string;
  estio_location_id: string | null;
  created_at: string;
}

export interface SubstoStudioWorkspace extends StudioWorkspace {
  role: "owner" | "admin" | "member";
}

interface WorkspaceMembershipRow {
  workspace_id: string;
  role: SubstoStudioWorkspace["role"];
}

async function readEstioStudioWorkspace(locationId: string): Promise<StudioWorkspace | null> {
  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    brand: "eq.estio",
    estio_location_id: `eq.${locationId}`,
    limit: "1",
  }));
  return rows[0] ?? null;
}

/** Cached per request; provisioning below always re-reads uncached. */
export const getEstioStudioWorkspace = cache(readEstioStudioWorkspace);

/** Cached per request. */
export const getEstioStudioWorkspaceById = cache(async (workspaceId: string): Promise<StudioWorkspace | null> => {
  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    id: `eq.${workspaceId}`,
    brand: "eq.estio",
    workspace_type: "eq.estio_location",
    limit: "1",
  }));
  return rows[0] ?? null;
});

export async function ensureEstioStudioWorkspace(
  location: { id: string; name: string | null },
): Promise<StudioWorkspace> {
  const existing = await readEstioStudioWorkspace(location.id);
  if (existing) return existing;

  const row = {
    brand: "estio",
    workspace_type: "estio_location",
    name: location.name?.trim() || "Estio Studio",
    estio_location_id: location.id,
  };

  try {
    const created = await studioRest<StudioWorkspace[]>("studio_workspaces", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (created[0]) return created[0];
  } catch (error) {
    // The unique location index makes concurrent first access safe. Re-read to
    // return the winner without creating a second workspace for that location.
    const concurrent = await readEstioStudioWorkspace(location.id);
    if (concurrent) return concurrent;
    throw error;
  }

  const concurrent = await readEstioStudioWorkspace(location.id);
  if (concurrent) return concurrent;
  throw new Error("Studio workspace could not be created for this Estio location.");
}

/**
 * Pre-brand Substo workspaces a Clerk user is a member of. Used only to adopt
 * them as brands; access is never granted from Studio membership directly.
 */
export async function listSubstoStudioWorkspaces(clerkUserId: string): Promise<SubstoStudioWorkspace[]> {
  if (await isPlatformProfileDeleted(studioRest, "substo", clerkUserId)) return [];
  const memberships = await studioRestAll<WorkspaceMembershipRow>("studio_workspace_memberships", {
    select: "workspace_id,role",
    workspace_brand: "eq.substo",
    clerk_user_id: `eq.${clerkUserId}`,
    order: "created_at.asc,id.asc",
  });
  if (memberships.length === 0) return [];

  const roleByWorkspace = new Map(memberships.map((membership) => [membership.workspace_id, membership.role]));
  const workspaces: StudioWorkspace[] = [];
  for (let index = 0; index < memberships.length; index += 100) {
    const ids = memberships.slice(index,index+100).map(({workspace_id}) => workspace_id);
    workspaces.push(...await studioRestAll<StudioWorkspace>("studio_workspaces", {
      select: "id,brand,workspace_type,name,estio_location_id,created_at",
      brand: "eq.substo", id: `in.(${ids.join(",")})`, order: "created_at.asc,id.asc",
    }));
  }
  workspaces.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return workspaces.flatMap((workspace) => {
    const role = roleByWorkspace.get(workspace.id);
    return role ? [{ ...workspace, role }] : [];
  });
}

export async function createSubstoStudioWorkspace(
  name: string,
  clerkUserId: string,
  workspaceId: string,
): Promise<string> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw new Error("Workspace name must be between 1 and 100 characters.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error("Workspace request ID is invalid.");

  const result = await studioRest<string>("rpc/studio_create_substo_workspace", {
    method: "POST",
    body: JSON.stringify({
      p_workspace_id: workspaceId,
      p_name: normalizedName,
      p_clerk_user_id: clerkUserId,
    }),
  });
  if (!/^[0-9a-f-]{36}$/i.test(result)) {
    throw new Error("Studio workspace creation returned an invalid identifier.");
  }
  return result;
}

const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireWorkspaceId(workspaceId: string) {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error("Studio workspace ID is invalid.");
}

export async function substoStudioWorkspaceExists(workspaceId: string): Promise<boolean> {
  requireWorkspaceId(workspaceId);
  const rows = await studioRest<Array<{ id: string }>>(queryPath("studio_workspaces", {
    select: "id", id: `eq.${workspaceId}`, brand: "eq.substo", workspace_type: "eq.substo_standalone", limit: "1",
  }));
  return rows.length === 1;
}

/** Cached per request. */
export const getSubstoStudioWorkspace = cache(async (workspaceId: string): Promise<StudioWorkspace | null> => {
  requireWorkspaceId(workspaceId);
  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    id: `eq.${workspaceId}`, brand: "eq.substo", workspace_type: "eq.substo_standalone", limit: "1",
  }));
  return rows[0] ?? null;
});

export async function renameSubstoStudioWorkspace(workspaceId: string, name: string): Promise<void> {
  requireWorkspaceId(workspaceId);
  await studioRest<unknown>(queryPath("studio_workspaces", { id: `eq.${workspaceId}`, brand: "eq.substo" }), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name: name.trim() }),
  });
}

/**
 * Studio membership rows for Substo are a mirror of the brand team (the source
 * of truth in Business). They are kept because Studio's SQL functions lock and
 * check them on every write.
 */
export async function listSubstoWorkspaceMembers(workspaceId: string): Promise<Array<{ clerkUserId: string; role: SubstoStudioWorkspace["role"] }>> {
  requireWorkspaceId(workspaceId);
  const rows = await studioRestAll<{ clerk_user_id: string; role: SubstoStudioWorkspace["role"] }>("studio_workspace_memberships", {
    select: "clerk_user_id,role", workspace_id: `eq.${workspaceId}`, workspace_brand: "eq.substo", order: "created_at.asc,id.asc",
  });
  return rows.map((row) => ({ clerkUserId: row.clerk_user_id, role: row.role }));
}

export async function getSubstoMembershipRole(workspaceId: string, clerkUserId: string): Promise<SubstoStudioWorkspace["role"] | null> {
  requireWorkspaceId(workspaceId);
  const rows = await studioRest<WorkspaceMembershipRow[]>(queryPath("studio_workspace_memberships", {
    select: "workspace_id,role", workspace_id: `eq.${workspaceId}`, workspace_brand: "eq.substo", clerk_user_id: `eq.${clerkUserId}`, limit: "1",
  }));
  return rows[0]?.role ?? null;
}

export async function upsertSubstoMembership(workspaceId: string, clerkUserId: string, role: SubstoStudioWorkspace["role"]): Promise<void> {
  requireWorkspaceId(workspaceId);
  if (await isPlatformProfileDeleted(studioRest, "substo", clerkUserId)) throw new Error("This profile was deleted.");
  await studioRest<unknown>(`studio_workspace_memberships?on_conflict=workspace_id,clerk_user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, workspace_brand: "substo", clerk_user_id: clerkUserId, role }),
  });
}

export async function deleteSubstoMembership(workspaceId: string, clerkUserId: string): Promise<void> {
  requireWorkspaceId(workspaceId);
  await studioRest<unknown>(queryPath("studio_workspace_memberships", {
    workspace_id: `eq.${workspaceId}`, workspace_brand: "eq.substo", clerk_user_id: `eq.${clerkUserId}`,
  }), { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
