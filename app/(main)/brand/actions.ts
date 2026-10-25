"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseBrandRole } from "@/lib/brands/brand-policy";
import {
  changeMemberRole,
  inviteToBrand,
  removeMember,
  renameBrand,
  revokeBrandInvitation,
  type TeamResult,
} from "@/lib/brands/brand-service";
import { getSubstoBrandActor, substoBrandDeps, substoSignUpUrl } from "@/lib/brands/substo-brands";

export type BrandFormState = { error?: string; message?: string };

const toState = (result: TeamResult): BrandFormState => (result.ok ? { message: result.message } : { error: result.error });

/** Bind to the rendered tenant and recheck current membership/role on every submission. */
async function requireActor(formData: FormData) {
  const locationId = formData.get("locationId");
  if (typeof locationId !== "string" || !locationId) redirect("/studio?error=access");
  const actor = await getSubstoBrandActor(locationId);
  if (!actor) redirect("/studio?choose=1");
  return actor;
}

export async function inviteBrandMemberAction(_previous: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const actor = await requireActor(formData);
  const role = parseBrandRole(formData.get("role"));
  if (!role) return { error: "Choose a role." };
  const signUpUrl = await substoSignUpUrl();
  if (!signUpUrl) return { error: "The sign-up address could not be resolved." };
  const result = await inviteToBrand(substoBrandDeps(), actor, { email: formData.get("email"), role, signUpUrl });
  revalidatePath("/brand/team");
  return toState(result);
}

export async function revokeBrandInvitationAction(formData: FormData) {
  const actor = await requireActor(formData);
  await revokeBrandInvitation(substoBrandDeps(), actor, String(formData.get("invitationId") || ""));
  revalidatePath("/brand/team");
}

export async function changeBrandMemberRoleAction(_previous: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const actor = await requireActor(formData);
  const role = parseBrandRole(formData.get("role"));
  if (!role) return { error: "Choose a role." };
  const result = await changeMemberRole(substoBrandDeps(), actor, String(formData.get("userId") || ""), role);
  revalidatePath("/brand/team");
  return toState(result);
}

export async function removeBrandMemberAction(_previous: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const actor = await requireActor(formData);
  const targetUserId = String(formData.get("userId") || "");
  const result = await removeMember(substoBrandDeps(), actor, targetUserId);
  if (result.ok && targetUserId === actor.userId) redirect("/studio?choose=1");
  revalidatePath("/brand/team");
  return toState(result);
}

export async function renameBrandAction(_previous: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const actor = await requireActor(formData);
  const result = await renameBrand(substoBrandDeps(), actor, formData.get("name"));
  revalidatePath("/brand", "layout");
  revalidatePath("/studio", "layout");
  return toState(result);
}
