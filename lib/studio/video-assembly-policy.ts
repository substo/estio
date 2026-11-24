export interface VideoAssemblyOptions { voiceover: boolean; music: boolean; portrait: boolean; /** Library voice for the voiceover (required when voiceover is on). */ voiceId?: string }
/** Checkbox form fields to options. Anything else in the form is ignored. */
export function readVideoAssemblyOptions(form: FormData): VideoAssemblyOptions {
  const voiceover = form.get("voiceover") === "on", voiceId = String(form.get("voiceId") ?? "");
  return { voiceover, music: form.get("music") === "on", portrait: form.get("portrait") === "on", ...(voiceover && /^[0-9a-f-]{36}$/i.test(voiceId) ? { voiceId } : {}) };
}
export type VideoAssemblyReason = "no_content" | "no_script" | "script_too_long" | "no_footage" | "footage_too_large" | "no_mac" | "processing_off" | "mac_not_ready" | "companion_outdated" | "no_authority" | "no_voice" | "narration_not_ready";
export const videoAssemblyMessages: Record<VideoAssemblyReason, string> = {
  no_content: "This content piece was not found.",
  no_script: "Save a script on this piece first.",
  script_too_long: "The saved script is too long for one video (20,000 characters).",
  no_footage: "Upload the footage you shot to this piece first, or turn on voiceover to start from the script alone.",
  footage_too_large: "The footage on this piece is larger than 20 GB. Remove some and try again.",
  no_mac: "Pair a Mac in Setup to make videos. Nothing was sent to a paid service.",
  processing_off: "Turn Mac processing on in Setup to make videos.",
  mac_not_ready: "Your Mac needs the Substo Video editor, ffprobe and the Claude subscription sign-in. Check Setup, then try again.",
  companion_outdated: "Update the Studio companion on your Mac (it does not make videos yet).",
  no_authority: "Only a Business admin with a paired Mac can make videos.",
  no_voice: "Choose a voice for the voiceover in Voices, or turn voiceover off.",
  narration_not_ready: "The narration could not be prepared. Nothing was sent to your Mac. Try again.",
};
export const videoAssemblyCodeReason: Record<string, VideoAssemblyReason> = {
  VA001: "no_content", VA002: "no_script", VA003: "script_too_long", VA004: "no_footage", VA005: "footage_too_large",
  VA011: "no_mac", VA012: "processing_off", VA013: "mac_not_ready", VA014: "companion_outdated", VA006: "no_voice", VA007: "narration_not_ready", "42501": "no_authority",
};
export type VideoAssemblyJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface VideoAssemblyView { jobId: string; status: VideoAssemblyJobStatus; message: string | null; summary: string | null; createdAt: string }
/** One calm line for the record page; the Mac's own failure text is already user-safe and bounded. */
export interface NarrationView { status: "running" | "done" | "failed"; done: number; total: number; message: string | null; jobId: string | null; createdAt: string }
export function videoAssemblyStatusLine(view: VideoAssemblyView | null, macOnline: boolean | null, narration: NarrationView | null = null): string | null {
  // The narration step comes first: its progress, or its failure when nothing newer has started.
  if (narration?.status === "running") return `Preparing the narration: ${narration.done} of ${narration.total} voiced…`;
  if (narration?.status === "failed" && (!view || Date.parse(narration.createdAt) > Date.parse(view.createdAt))) return narration.message ?? videoAssemblyMessages.narration_not_ready;
  if (!view) return null;
  if (view.status === "queued") return macOnline === false ? "Waiting for your Mac to come online." : "Queued for your Mac.";
  if (view.status === "running") return "Your Mac is editing the video. This can take several minutes.";
  if (view.status === "succeeded") return view.summary ? `Done: ${view.summary}` : "Done. The edited video is in this piece's uploads below.";
  return view.message ?? (view.status === "cancelled" ? "Cancelled because the Mac's settings changed. Make the video again." : "The Mac could not finish this video. Make it again.");
}

/** The edit loop on a made video: ask the agent for a change, reopen the project in the editor. */
export type VideoLoopReason = "edit_no_content" | "edit_bad_instruction" | "edit_no_project" | "edit_busy" | "edit_no_mac" | "edit_processing_off" | "edit_mac_not_ready" | "edit_companion_outdated" | "no_authority";
export const videoLoopMessages: Record<VideoLoopReason, string> = {
  edit_no_content: "This content piece was not found.",
  edit_bad_instruction: "Describe the change in a sentence or two (up to 1,000 characters).",
  edit_no_project: "There is no kept edit for this piece yet. Make the video first.",
  edit_busy: "The agent is already working on this video. Wait for it to finish.",
  edit_no_mac: "Pair a Mac in Setup to change videos. Nothing was sent to a paid service.",
  edit_processing_off: "Turn Mac processing on in Setup to change videos.",
  edit_mac_not_ready: "Your Mac needs the Substo Video editor, ffprobe and the Claude subscription sign-in. Check Setup, then try again.",
  edit_companion_outdated: "Update the Studio companion on your Mac (it cannot change videos yet).",
  no_authority: "Only a Business admin with a paired Mac can change videos.",
};
export const videoLoopCodeReason: Record<string, VideoLoopReason> = {
  VE001: "edit_no_content", VE002: "edit_bad_instruction", VE003: "edit_no_project", VE004: "edit_busy", VE011: "edit_no_mac", VE012: "edit_processing_off", VE013: "edit_mac_not_ready", VE014: "edit_companion_outdated", "42501": "no_authority",
};
export interface VideoVersion { id: string; name: string; bytes: number; createdAt: string; /** What the Mac's timeline looked like for this export; absent for older exports. */ timeline?: import("./workspace/timeline").TimelineSnapshot | null }
export interface VideoThreadMessage { id: string; instruction: string; createdAt: string; status: VideoAssemblyJobStatus; reply: string | null }
export interface VideoLoopState { projectKept: boolean; versions: VideoVersion[]; thread: VideoThreadMessage[]; openEditor: { jobId: string; status: VideoAssemblyJobStatus; message: string | null } | null; busy: boolean }
/** One line for a thread message's state. */
export function threadReplyLine(m: VideoThreadMessage): string {
  if (m.status === "queued") return "Waiting for your Mac…";
  if (m.status === "running") return "Working on it. This can take several minutes.";
  return m.reply ?? (m.status === "cancelled" ? "Cancelled because the Mac's settings changed." : "The Mac could not finish this change.");
}
/** Short label for the open-in-editor result. */
export function openEditorLine(o: VideoLoopState["openEditor"]): string | null {
  if (!o) return null;
  if (o.status === "queued") return "Asking your Mac to open the editor…";
  if (o.status === "running") return "Opening the editor…";
  if (o.status === "succeeded") return "Opened on your Mac.";
  return o.message ?? "Could not open the editor.";
}
