import { formatTime, type TimelineClip } from "./timeline";
export type ClipAction = "trim" | "replace" | "delete" | "retake" | "ask";
export interface SelectedClip { track: string; clip: TimelineClip }
export const clipActionLabels: Record<ClipAction, string> = { trim: "Trim", replace: "Replace", delete: "Delete", retake: "Retake audio", ask: "Ask the agent" };
export const MAX_INSTRUCTION = 1000;
export const clipLabel = ({ track, clip }: SelectedClip) => `${track} · ${clip.l} · ${formatTime(clip.s)}–${formatTime(clip.e)}`;
/** What an action puts in the agent's box. It is only a starting point: the user edits it (how long, how, what instead) and sends it. Nothing is sent by choosing an action. */
export function clipStarter(action: ClipAction): string {
  switch (action) {
    case "trim": return "Trim 2 seconds off the end of this clip.";
    case "replace": return "Replace this clip with ";
    case "delete": return "Delete this clip and close the gap.";
    case "retake": return "Retake the audio for this clip: ";
    default: return "";
  }
}
/** The focus the agent is given when a message is sent with a clip selected. */
export const focusedInstruction = (selected: SelectedClip, text: string) => `On the ${selected.track} track, the ${selected.clip.k} clip "${selected.clip.l}" (${formatTime(selected.clip.s)} to ${formatTime(selected.clip.e)}): ${text.trim()}`.replace(/\s+/g, " ").trim().slice(0, MAX_INSTRUCTION);
export const suggestedPrompts = (hasSelection: boolean) => hasSelection
  ? ["Make this shorter", "Replace this with something else", "Add a sound effect here"]
  : ["Make the intro shorter", "Add a whoosh on each title", "Fill the gaps with labelled placeholders", "Make the captions larger"];
