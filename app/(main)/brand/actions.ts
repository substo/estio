"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseLocationRole } from "@/lib/locations/location-policy";
import {
  changeMemberRole,
  inviteToLocation,
  removeMember,
  renameLocation,
  revokeLocationInvitation,
  type TeamResult,
} from "@/lib/locations/location-service";
import { getSubstoLocationActor, substoLocationDeps, substoSignUpUrl } from "@/lib/locations/substo-locations";
import { isStudioProviderUnavailable } from "@/lib/studio/rest";

export type LocationFormState = { error?: string; message?: string };

const toState = (result: TeamResult): LocationFormState => (result.ok ? { message: result.message } : { error: result.error });

/** Role changes and removals update Studio's team mirror first, so they wait while Studio is unavailable. */
async function whileStudioReachable(change: () => Promise<TeamResult>): Promise<TeamResult> {
  try { return await change(); }
  catch (error) {
    if (!isStudioProviderUnavailable(error)) throw error;
    return { ok: false, error: "Studio is temporarily unavailable, so team roles can't change right now. Please try again later." };
  }
}

/** Bind to the rendered tenant and recheck current membership/role on every submission. */
async function requireActor(formData: FormData) {
  const locationId = formData.get("locationId");
  if (typeof locationId !== "string" || !locationId) redirect("/studio/select?error=access");
  const actor = await getSubstoLocationActor(locationId);
  if (!actor) redirect("/studio/select?choose=1");
  return actor;
}

export async function inviteLocationMemberAction(_previous: LocationFormState, formData: FormData): Promise<LocationFormState> {
  const actor = await requireActor(formData);
  const role = parseLocationRole(formData.get("role"));
  if (!role) return { error: "Choose a role." };
  const signUpUrl = await substoSignUpUrl();
  if (!signUpUrl) return { error: "The sign-up address could not be resolved." };
  const result = await inviteToLocation(substoLocationDeps(), actor, { email: formData.get("email"), role, signUpUrl });
  revalidatePath("/brand/team");
  return toState(result);
}

export async function revokeLocationInvitationAction(formData: FormData) {
  const actor = await requireActor(formData);
  await revokeLocationInvitation(substoLocationDeps(), actor, String(formData.get("invitationId") || ""));
  revalidatePath("/brand/team");
}

export async function changeLocationMemberRoleAction(_previous: LocationFormState, formData: FormData): Promise<LocationFormState> {
  const actor = await requireActor(formData);
  const role = parseLocationRole(formData.get("role"));
  if (!role) return { error: "Choose a role." };
  const result = await whileStudioReachable(() => changeMemberRole(substoLocationDeps(), actor, String(formData.get("userId") || ""), role));
  revalidatePath("/brand/team");
  return toState(result);
}

export async function removeLocationMemberAction(_previous: LocationFormState, formData: FormData): Promise<LocationFormState> {
  const actor = await requireActor(formData);
  const targetUserId = String(formData.get("userId") || "");
  const result = await whileStudioReachable(() => removeMember(substoLocationDeps(), actor, targetUserId));
  if (result.ok && targetUserId === actor.userId) redirect("/studio/select?choose=1");
  revalidatePath("/brand/team");
  return toState(result);
}

export async function renameLocationAction(_previous: LocationFormState, formData: FormData): Promise<LocationFormState> {
  const actor = await requireActor(formData);
  const result = await renameLocation(substoLocationDeps(), actor, formData.get("name"));
  revalidatePath("/brand", "layout");
  revalidatePath("/studio", "layout");
  return toState(result);
}
