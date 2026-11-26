"use server";

import { requestStoryboard } from "@/lib/studio/storyboard";
import { approveClipSuggestion } from "@/lib/studio/clip-suggestions-server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStudioAccess } from "@/lib/studio/access";
import { readContentDraft } from "@/lib/studio/content-policy";
import { createStudioSourceIdea, getStudioContentRecord, saveStudioContentRecord } from "@/lib/studio/content";
import { regenerateBlockAudio, type RegenerateResult } from "@/lib/studio/script-audio";
import { StudioRestError } from "@/lib/studio/rest";
import { StudioCommandError } from "@/lib/studio/command-error";
import { requestVideoEdit, requestOpenEditor, stopVideoWork } from "@/lib/studio/video-loop";
import { discardUnfinishedUploads } from "@/lib/studio/uploads";
import { requestVideoAssembly } from "@/lib/studio/video-assembly";
import { readVideoAssemblyOptions } from "@/lib/studio/video-assembly-policy";
import { readMotionChoiceFromForm } from "@/lib/studio/video-assembly/motion-style";
import { setMotionChoice } from "@/lib/studio/voices/sources-store";
import { readScriptTemplateSelection } from "@/lib/studio/script-template-policy";

export async function saveContentAction(
  locationId: string, recordId: string, version: number,
  _previous: { error?: string }, form: FormData,
): Promise<{ error?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  let draft;
  let templateVersionId;
  try { draft = readContentDraft(form); templateVersionId = readScriptTemplateSelection(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the content fields." }; }
  try { await saveStudioContentRecord(locationId, recordId, draft, version, templateVersionId); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { error: "This piece changed in another tab. Keep your draft, reload the latest piece, and review its changes before saving." };
    if (error instanceof StudioRestError && error.code === "23505") return { error: "This piece already exists. Reload its latest version." };
    if (error instanceof StudioCommandError) return { error: error.message };
    if (templateVersionId !== undefined && error instanceof StudioRestError && error.code === "22023") return { error: "Choose an approved template in this Location for active content, or continue without a template." };
    console.error("[studio-content] Save failed", error instanceof StudioRestError ? { status: error.status, code: error.code } : { type: "unavailable" });
    return { error: "Studio could not save this piece. Your draft is still here; try again." };
  }
  revalidatePath(`/studio/content`);
  redirect(`/studio/content/${recordId}`);
}

export async function createSourceIdeaAction(locationId: string, sourceId: string, ideaId: string, draftReviewId: string | undefined,
  _previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  try {
    await createStudioSourceIdea(locationId, sourceId, ideaId, String(form.get("title") || ""), String(form.get("summary") || ""), draftReviewId);
  } catch {
    return { error: "Could not create this idea with its source. Your draft is still here. Check that the source is active and use your own account, then retry." };
  }
  revalidatePath("/studio/content");
  revalidatePath(`/studio/library/${sourceId}`);
  redirect(`/studio/content/${ideaId}`);
}

export async function askVideoEditAction(locationId: string, recordId: string, _previous: { error?: string; notice?: string }, form: FormData): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const result = await requestVideoEdit(locationId, recordId, String(form.get("instruction") ?? ""));
    if (!result.ok) return { error: result.message };
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: "Sent to your Mac." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "Studio could not send this to your Mac. Try again." };
  }
}
export async function stopVideoAction(locationId: string, recordId: string, _previous: { error?: string; notice?: string }): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const result = await stopVideoWork(locationId, recordId);
    if (!result.ok) return { error: result.message };
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: result.stopped ? "Stopping. Your Mac stops within a minute; edits already saved stay in the project history." : "Nothing was running." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "Studio could not stop this. Try again." };
  }
}
export async function openEditorAction(locationId: string, recordId: string, _previous: { error?: string; notice?: string }): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const result = await requestOpenEditor(locationId, recordId);
    if (!result.ok) return { error: result.message };
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: "Asking your Mac to open the editor." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "Studio could not send this to your Mac. Try again." };
  }
}
export async function makeVideoAction(locationId: string, recordId: string, _previous: { error?: string; notice?: string }, form: FormData): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    // The look is saved on the Location first, so the next video starts from the last choice and the Mac reads it at claim time.
    await setMotionChoice(locationId, readMotionChoiceFromForm(form)).catch(() => null);
    const result = await requestVideoAssembly(locationId, recordId, readVideoAssemblyOptions(form));
    if (!result.ok) return { error: result.message };
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: result.reused ? "A video is already being made for this piece." : result.narrating ? "Preparing the narration. This page shows the progress, and the Mac starts when it is ready." : "Sent to your Mac." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "Studio could not send this to your Mac. Try again." };
  }
}

/** Ask the signed-in user's own Mac to draw one picture per beat of the saved script. Nothing is paid for: the Mac draws with the creator's ChatGPT login. */
export async function drawStoryboardAction(locationId: string, recordId: string, portrait: boolean, only?: number[]): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const result = await requestStoryboard(locationId, recordId, portrait, Array.isArray(only) ? only.filter(n => Number.isInteger(n) && n >= 1 && n <= 40) : undefined);
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: result.reused ? "The storyboard is already being drawn." : "Sent to your Mac. The pictures appear here as they finish." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "Studio could not send this to your Mac. Try again." };
  }
}

/** The creator approves a suggested clip: it joins the script as a source clip block, and Make video places it. */
export async function approveClipAction(locationId: string, recordId: string, pick: { blockId: string; uploadId: string; start: number; end: number }): Promise<{ error?: string; notice?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    await approveClipSuggestion(locationId, recordId, { blockId: String(pick.blockId), uploadId: String(pick.uploadId), start: Number(pick.start), end: Number(pick.end) });
    revalidatePath(`/studio/content/${recordId}`);
    return { notice: "Added to the script as a source clip. Make video will place it." };
  } catch (error) {
    if (error instanceof StudioCommandError) return { error: error.message };
    return { error: "The clip could not be added. Reload the page and try again." };
  }
}

export type AutosaveResult = { ok: true; version: number } | { ok: false; error: string; conflict?: boolean };
/** Autosave for the block editor: the same version-fenced save as the form (stale versions are refused, never overwritten), without the redirect. Only the blocks and the voice are written. */
export async function autosaveScriptAction(locationId: string, recordId: string, version: number, scriptBlocks: string, voiceId: string): Promise<AutosaveResult> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const current = await getStudioContentRecord(locationId, recordId);
    if (!current) return { ok: false, error: "This piece could not be found." };
    const form = new FormData(); form.set("title", current.record.title); form.set("scriptBlocks", scriptBlocks); form.set("voiceId", voiceId);
    const saved = await saveStudioContentRecord(locationId, recordId, readContentDraft(form), version);
    return { ok: true, version: Number((saved as { version?: unknown }).version ?? version + 1) };
  } catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { ok: false, conflict: true, error: "This piece changed in another tab. Your edits are still here; reload the latest piece and review before saving." };
    if (error instanceof Error && /script|block|voice/i.test(error.message) && !(error instanceof StudioRestError)) return { ok: false, error: error.message };
    console.error("[studio-content] Autosave failed", error instanceof StudioRestError ? { status: error.status, code: error.code } : { type: "unavailable" });
    return { ok: false, error: "Could not save. Your edits are still here; retrying." };
  }
}

export async function regenerateBlockAudioAction(locationId: string, recordId: string, version: number, only: string[] | null): Promise<RegenerateResult> {
  if (!await getStudioAccess(locationId)) notFound();
  if (only && (only.length > 200 || only.some(id => typeof id !== "string" || id.length > 40))) return { ok: false, error: "Choose valid blocks." };
  try { return await regenerateBlockAudio(locationId, recordId, version, only ?? undefined); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { ok: false, error: "The script changed while audio was generating. Reload the piece; generated clips are kept." };
    console.error("[studio-content] Block audio failed", { type: error instanceof Error ? error.constructor.name : "unknown" });
    return { ok: false, error: "Could not generate audio. Try again." };
  }
}

export async function discardUnfinishedUploadsAction(locationId: string, recordId: string, uploadId: string | null): Promise<{ ok: true; discarded: number } | { ok: false; error: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  try {
    const { discarded } = await discardUnfinishedUploads(locationId, recordId, uploadId);
    revalidatePath(`/studio/content/${recordId}`);
    return { ok: true, discarded };
  } catch (error) {
    if (error instanceof StudioCommandError) return { ok: false, error: error.message };
    console.error("[studio-content] Discard failed", { type: error instanceof Error ? error.constructor.name : "unknown" });
    return { ok: false, error: "Could not discard. Try again." };
  }
}
