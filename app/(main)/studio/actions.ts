"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { studioInvitationStatus } from "@/lib/studio/invitation-policy";
import { StudioRestError } from "@/lib/studio/rest";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_LOCATION_COOKIE, ACTIVE_LOCATION_COOKIE_OPTIONS } from "@/lib/auth/active-location";
import { getEstioStudioLocationAccess, getStudioWorkspaceAccess } from "@/lib/studio/access";
import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "@/lib/auth/host-brand";
import { acceptSubstoStudioInvitation, createSubstoStudioInvitation, createSubstoStudioWorkspace, ensureEstioStudioWorkspace, getSubstoStudioInvitation, getSubstoStudioWorkspaceForUser } from "@/lib/studio/supabase-service";

async function getRequestBrand() {
  return resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
}

export async function openEstioStudioLocation(formData: FormData) {
  const locationId = String(formData.get("locationId") || "").trim();
  const access = await getEstioStudioLocationAccess(locationId);
  if (!access) redirect("/studio?error=access");

  (await cookies()).set(ACTIVE_LOCATION_COOKIE, access.location.id, ACTIVE_LOCATION_COOKIE_OPTIONS);
  const workspace = await ensureEstioStudioWorkspace({
    id: access.location.id,
    name: access.location.name,
  });
  redirect(`/studio/workspace/${workspace.id}`);
}

export async function openEstioStudioBusinessAction(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || access.brand !== "estio") redirect("/studio?error=access");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, access.locationId, ACTIVE_LOCATION_COOKIE_OPTIONS);
  redirect("/admin");
}

export async function createSubstoWorkspaceAction(formData: FormData) {
  if (await getRequestBrand() !== "substo") redirect("/studio");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fstudio");

  const name = String(formData.get("name") || "").trim();
  const workspaceId = String(formData.get("workspaceRequestId") || "").trim();
  if (!name || name.length > 100 || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    redirect("/studio?error=workspace");
  }

  const id = await createSubstoStudioWorkspace(name, userId, workspaceId);
  redirect(`/studio/workspace/${id}`);
}

export interface CreateStudioInviteState {
  error?: string;
  link?: string;
}

export async function createSubstoStudioInviteAction(
  workspaceId: string,
  _previousState: CreateStudioInviteState,
  formData: FormData,
): Promise<CreateStudioInviteState> {
  if (await getRequestBrand() !== "substo") return { error: "Invitations are only available in Substo Studio." };
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to invite a teammate." };

  const workspace = await getSubstoStudioWorkspaceForUser(workspaceId, userId);
  if (!workspace || (workspace.role !== "owner" && workspace.role !== "admin")) {
    return { error: "Only workspace owners and admins can invite teammates." };
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "member");
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (role !== "admin" && role !== "member") return { error: "Choose a valid workspace role." };
  if (role === "admin" && workspace.role !== "owner") {
    return { error: "Only the workspace owner can invite another admin." };
  }

  const token = randomBytes(32).toString("base64url");
  const host = (await headers()).get("host");
  const origin = getHostOrigin(host);
  if (!origin) return { error: "The Studio hostname could not be resolved." };
  await createSubstoStudioInvitation({ workspaceId, clerkUserId: userId, email, role, token });
  return { link: `${origin}/studio/invite/${token}` };
}

export async function acceptSubstoStudioInviteAction(token: string) {
  if (await getRequestBrand() !== "substo" || !/^[A-Za-z0-9_-]{43}$/.test(token)) redirect("/studio");
  const user = await currentUser();
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/studio/invite/${token}`)}`);

  const verifiedEmails = user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress);
  if (verifiedEmails.length === 0) redirect(`/studio/invite/${token}?error=verified-email`);
  const invitation = await getSubstoStudioInvitation(token);
  const status = studioInvitationStatus(invitation, user.id);
  if (!invitation || status === "invalid" || status === "used") redirect(`/studio/invite/${token}?error=invalid`);
  const verifiedEmail = verifiedEmails.find((email) => email.trim().toLowerCase() === invitation.email.trim().toLowerCase());
  if (!verifiedEmail) redirect(`/studio/invite/${token}?error=email-mismatch`);
  let workspaceId: string;
  try {
    workspaceId = await acceptSubstoStudioInvitation({ token, verifiedEmail, clerkUserId: user.id });
  } catch (error) {
    if (error instanceof StudioRestError && (error.code === "P0002" || error.code === "42501")) {
      redirect(`/studio/invite/${token}?error=invalid`);
    }
    throw error;
  }
  redirect(`/studio/workspace/${workspaceId}`);
}
