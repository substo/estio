import "server-only";
import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { createHash } from "node:crypto";
import { queryPath, studioRest, studioRestAll } from "./rest";
import type { StudioInvitationState } from "./invitation-policy";

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

export async function getEstioStudioWorkspace(locationId: string): Promise<StudioWorkspace | null> {
  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    brand: "eq.estio",
    estio_location_id: `eq.${locationId}`,
    limit: "1",
  }));
  return rows[0] ?? null;
}

export async function getEstioStudioWorkspaceById(workspaceId: string): Promise<StudioWorkspace | null> {
  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    id: `eq.${workspaceId}`,
    brand: "eq.estio",
    workspace_type: "eq.estio_location",
    limit: "1",
  }));
  return rows[0] ?? null;
}

export async function ensureEstioStudioWorkspace(
  location: { id: string; name: string | null },
): Promise<StudioWorkspace> {
  const existing = await getEstioStudioWorkspace(location.id);
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
    const concurrent = await getEstioStudioWorkspace(location.id);
    if (concurrent) return concurrent;
    throw error;
  }

  const concurrent = await getEstioStudioWorkspace(location.id);
  if (concurrent) return concurrent;
  throw new Error("Studio workspace could not be created for this Estio location.");
}

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

export async function getSubstoStudioWorkspaceForUser(
  workspaceId: string,
  clerkUserId: string,
): Promise<SubstoStudioWorkspace | null> {
  if (await isPlatformProfileDeleted(studioRest, "substo", clerkUserId)) return null;
  const memberships = await studioRest<WorkspaceMembershipRow[]>(queryPath("studio_workspace_memberships", {
    select: "workspace_id,role",
    workspace_brand: "eq.substo",
    workspace_id: `eq.${workspaceId}`,
    clerk_user_id: `eq.${clerkUserId}`,
    limit: "1",
  }));
  const membership = memberships[0];
  if (!membership) return null;

  const rows = await studioRest<StudioWorkspace[]>(queryPath("studio_workspaces", {
    select: "id,brand,workspace_type,name,estio_location_id,created_at",
    id: `eq.${workspaceId}`,
    brand: "eq.substo",
    workspace_type: "eq.substo_standalone",
    limit: "1",
  }));
  return rows[0] ? { ...rows[0], role: membership.role } : null;
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

export async function createSubstoStudioInvitation(input: {
  workspaceId: string;
  clerkUserId: string;
  email: string;
  role: "admin" | "member";
  token: string;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  await studioRest<unknown>("studio_workspace_invitations", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      workspace_brand: "substo",
      email,
      role: input.role,
      token_hash: tokenHash,
      invited_by_clerk_user_id: input.clerkUserId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
}

export async function acceptSubstoStudioInvitation(input: {
  token: string;
  verifiedEmail: string;
  clerkUserId: string;
}): Promise<string> {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const membershipId = await studioRest<string>("rpc/studio_accept_substo_invitation", {
    method: "POST",
    body: JSON.stringify({
      p_token_hash: tokenHash,
      p_verified_email: input.verifiedEmail.trim().toLowerCase(),
      p_clerk_user_id: input.clerkUserId,
    }),
  });
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) {
    throw new Error("Invitation acceptance returned an invalid membership identifier.");
  }

  const rows = await studioRest<Array<{ workspace_id: string }>>(queryPath("studio_workspace_memberships", {
    select: "workspace_id",
    id: `eq.${membershipId}`,
    workspace_brand: "eq.substo",
    clerk_user_id: `eq.${input.clerkUserId}`,
    limit: "1",
  }));
  if (!rows[0]?.workspace_id) throw new Error("Invitation membership could not be resolved.");
  return rows[0].workspace_id;
}

export async function getSubstoStudioInvitation(token: string): Promise<StudioInvitationState | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await studioRest<StudioInvitationState[]>(queryPath("studio_workspace_invitations", {
    select: "email,expires_at,revoked_at,accepted_at,accepted_by_clerk_user_id",
    token_hash: `eq.${tokenHash}`,
    workspace_brand: "eq.substo",
    limit: "1",
  }));
  return rows[0] ?? null;
}
