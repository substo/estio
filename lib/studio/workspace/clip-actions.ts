import { formatTime, type TimelineClip } from "./timeline";
export type ClipAction = "trim" | "replace" | "delete" | "retake" | "ask";
export interface SelectedClip { track: string; clip: TimelineClip }
export const clipActionLabels: Record<ClipAction, string> = { trim: "Trim", replace: "Replace", delete: "Delete", retake: "Retake audio", ask: "Ask the agent" };
export const MAX_INSTRUCTION = 1000;
export const clipLabel = ({ track, clip }: SelectedClip) => `${track} · ${clip.l} · ${formatTime(clip.s)}–${formatTime(clip.e)}`;
/** A structured instruction for the existing studio.video_edit agent job. The user's own words, when given, are appended and the whole thing stays within the server's bound. */
export function clipInstruction(action: ClipAction, selected: SelectedClip, extra = ""): string {
  const where = `On the ${selected.track} track, the ${selected.clip.k} clip "${selected.clip.l}" (${formatTime(selected.clip.s)} to ${formatTime(selected.clip.e)})`;
  const base: Record<ClipAction, string> = {
    trim: `${where}: trim it${extra.trim() ? "" : " a little tighter"}.`,
    replace: `${where}: replace it${extra.trim() ? "" : " with a better fit from the footage, or a clearly labelled placeholder if none fits"}.`,
    delete: `${where}: delete it and close or fill the gap.`,
    retake: `${where}: replace its audio with another take from the footage folder if one exists; if none does, say exactly what recording is needed.`,
    ask: `${where}:`,
  };
  return `${base[action]}${extra.trim() ? ` ${extra.trim()}` : ""}`.replace(/\s+/g, " ").trim().slice(0, MAX_INSTRUCTION);
}
export const suggestedPrompts = (hasSelection: boolean) => hasSelection
  ? ["Make this shorter", "Replace this with something else", "Add a sound effect here"]
  : ["Make the intro shorter", "Add a whoosh on each title", "Fill the gaps with labelled placeholders", "Make the captions larger"];
