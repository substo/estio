"use server";
import { revalidatePath } from "next/cache";
import { changeStudioRecordLink } from "@/lib/studio/record-links";
import { StudioRestError } from "@/lib/studio/rest";
import type { RecordLinkAction } from "@/lib/studio/record-link-policy";
export async function changeRecordLinkAction(workspaceId: string, sourceId: string, targetId: string, version: number,
  operation: RecordLinkAction, _previous: { error?: string; success?: boolean }, _form: FormData): Promise<{ error?: string; success?: boolean }> {
  try { await changeStudioRecordLink(workspaceId, sourceId, targetId, version, operation); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { error: "This record changed. Reload the latest links before trying again." };
    if (error instanceof StudioRestError && error.code === "P0002") return { error: "This record or target is no longer available in the workspace. Reload the page." };
    if (error instanceof StudioRestError && error.code === "22023") return { error: "Could not change this link. A record can add at most 100 outgoing links." };
    return { error: "Could not change this link. Check your workspace access and use your own account, then try again." };
  }
  const root = `/studio/workspace/${workspaceId}`;
  revalidatePath(`${root}/records/${sourceId}/links`);
  revalidatePath(`${root}/library/${sourceId}`);
  revalidatePath(`${root}/content/${sourceId}`);
  revalidatePath(`${root}/library`);
  revalidatePath(`${root}/content`);
  return { success: true };
}
