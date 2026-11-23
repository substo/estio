export interface VideoAssemblyOptions { voiceover: boolean; music: boolean; portrait: boolean }
/** Checkbox form fields to options. Anything else in the form is ignored. */
export function readVideoAssemblyOptions(form: FormData): VideoAssemblyOptions {
  return { voiceover: form.get("voiceover") === "on", music: form.get("music") === "on", portrait: form.get("portrait") === "on" };
}
export type VideoAssemblyReason = "no_content" | "no_script" | "script_too_long" | "no_footage" | "footage_too_large" | "no_mac" | "processing_off" | "mac_not_ready" | "companion_outdated" | "no_authority";
export const videoAssemblyMessages: Record<VideoAssemblyReason, string> = {
  no_content: "This content piece was not found.",
  no_script: "Save a script on this piece first.",
  script_too_long: "The saved script is too long for one video (20,000 characters).",
  no_footage: "Upload the footage you shot to this piece first, or turn on voiceover to start from the script alone.",
  footage_too_large: "The footage on this piece is larger than 20 GB. Remove some and try again.",
  no_mac: "Pair a Mac in Setup to make videos. Nothing was sent to a paid service.",
  processing_off: "Turn Mac processing on in Setup to make videos.",
  mac_not_ready: "Your Mac needs the Substo Video editor, ffprobe and the Claude subscription sign-in (and an ElevenLabs key for voiceover). Check Setup, then try again.",
  companion_outdated: "Update the Studio companion on your Mac (it does not make videos yet).",
  no_authority: "Only a Business admin with a paired Mac can make videos.",
};
export const videoAssemblyCodeReason: Record<string, VideoAssemblyReason> = {
  VA001: "no_content", VA002: "no_script", VA003: "script_too_long", VA004: "no_footage", VA005: "footage_too_large",
  VA011: "no_mac", VA012: "processing_off", VA013: "mac_not_ready", VA014: "companion_outdated", "42501": "no_authority",
};
export type VideoAssemblyJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface VideoAssemblyView { jobId: string; status: VideoAssemblyJobStatus; message: string | null; summary: string | null; createdAt: string }
/** One calm line for the record page; the Mac's own failure text is already user-safe and bounded. */
export function videoAssemblyStatusLine(view: VideoAssemblyView | null, macOnline: boolean | null): string | null {
  if (!view) return null;
  if (view.status === "queued") return macOnline === false ? "Waiting for your Mac to come online." : "Queued for your Mac.";
  if (view.status === "running") return "Your Mac is editing the video. This can take several minutes.";
  if (view.status === "succeeded") return view.summary ? `Done: ${view.summary}` : "Done. The edited video is in this piece's uploads below.";
  return view.message ?? (view.status === "cancelled" ? "Cancelled because the Mac's settings changed. Make the video again." : "The Mac could not finish this video. Make it again.");
}
