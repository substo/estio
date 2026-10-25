"use server";
import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { getSubstoBrandActor } from "@/lib/brands/substo-brands";
import { saveWebsiteSettings } from "@/lib/substo-sites/service";
export type WebsiteFormState = { error?: string; message?: string };
export async function saveSubstoWebsiteAction(_previous: WebsiteFormState, formData: FormData): Promise<WebsiteFormState> {
  await assertCrmActionAllowed("content/website/actions.ts", "saveSubstoWebsiteAction");
  const actor = await getSubstoBrandActor();
  if (!actor) return { error: "Brand admin access is required." };
  const result = await saveWebsiteSettings(db, actor, {
    slug: formData.get("slug"), published: formData.get("published") === "on", confirmAddressChange: formData.get("confirmAddressChange") === "on",
    settings: Object.fromEntries(["title", "description", "email", "accent", "logoUrl"].map((key) => [key, String(formData.get(key) || "")])),
  });
  revalidatePath("/admin/content/website");
  revalidatePath("/admin/content/pages");
  revalidatePath("/admin/content/posts");
  return result;
}
