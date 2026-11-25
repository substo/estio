import type { Beat } from "../video-assembly/script";
import { SHOT_SIZES, type ShotSize, type ShotSpec } from "./prompts";

/**
 * A storyboard frame for one script beat: the creator in a new scene, in a real shot (size, angle, lens), with the same locked
 * description of the person in every frame and continuity of clothing and light. A beat's own visual note is its scene; without one,
 * the frame shows the creator speaking the line. Sizes alternate so the sequence has rhythm, like a real shot list.
 */
export const STORYBOARD_CHARACTER = "the person in the reference photo, same face, hair and clothing";
const ROTATION: ShotSize[] = ["medium", "wide", "close-up", "medium close-up"].filter((s): s is ShotSize => (SHOT_SIZES as readonly string[]).includes(s));

export function shotForBeat(beat: Pick<Beat, "index" | "narration" | "direction">, portrait = false): ShotSpec {
  const note = (beat.direction ?? "").replace(/\s+/g, " ").trim();
  const line = beat.narration.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    size: ROTATION[(beat.index - 1) % ROTATION.length], angle: "eye-level",
    subject: note ? note.slice(0, 240) : `speaking to camera, mid-sentence, saying "${line}"`,
    character: STORYBOARD_CHARACTER,
    setting: "a bright, tidy home studio with a plain wall and a plant", lighting: "soft window light from camera-left", lens: "35mm, shallow depth of field",
    texture: "natural skin texture, subtle film grain", continuity: "same clothing, same light direction and same room in every frame",
    avoid: ["text", "extra people", "watermark"], aspect: portrait ? "9:16" : "16:9",
  };
}
