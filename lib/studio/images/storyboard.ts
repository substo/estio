import type { Beat } from "../video-assembly/script";
import { SHOT_SIZES, type ShotSize, type ShotSpec } from "./prompts";

/**
 * A storyboard frame for one script beat: the creator in a new scene, in a real shot (size, angle, lens), with the same locked
 * description of the person in every frame and continuity of clothing and light. A beat's own visual note is its scene; without one,
 * the frame shows the creator speaking the line. Sizes alternate so the sequence has rhythm, like a real shot list.
 */
export const STORYBOARD_CHARACTER = "the person in the reference photo, same face, hair and clothing";
const ROTATION: ShotSize[] = ["medium", "wide", "close-up", "medium close-up"].filter((s): s is ShotSize => (SHOT_SIZES as readonly string[]).includes(s));
const PERSON_IN_NOTE = /\b(presenter|host|creator|speaker|person|man|woman|face|selfie|talking head|speaking to camera|seated|standing|walking|holding|I am|I'm)\b/i;

/** A visual note owns the picture. Do not add the creator unless the note actually calls for a person. */
export const storyboardBeatNeedsPerson = (direction: string | null | undefined) => {
  const note = (direction ?? "").replace(/\s+/g, " ").trim();
  return !note || PERSON_IN_NOTE.test(note);
};

const SCREEN_NOTE = /\b(screen|phone|app|ui|interface|chips?|json|catalog|component|graphic|animation|split screen|dashboard|chatbot)\b/i;
const PERSON_NOTE = /\b(presenter|host|creator|speaker|talking|to camera|face|I am|me|my|hands? (on|resting)|seated|standing|walks?)\b/i;
/** A visual note that only describes a screen or graphic is drawn as a flat graphic, not as a photo of the creator. */
export const isGraphicNote = (note: string) => SCREEN_NOTE.test(note) && !PERSON_NOTE.test(note);

export function shotForBeat(beat: Pick<Beat, "index" | "narration" | "direction">, portrait = false): ShotSpec {
  const note = (beat.direction ?? "").replace(/\s+/g, " ").trim();
  const line = beat.narration.replace(/\s+/g, " ").trim().slice(0, 140);
  const person = storyboardBeatNeedsPerson(note);
  return {
    size: ROTATION[(beat.index - 1) % ROTATION.length], angle: "eye-level",
    subject: note ? note.slice(0, 240) : `speaking to camera, mid-sentence, saying "${line}"`,
    ...(person ? { character: STORYBOARD_CHARACTER } : { noCharacter: true }),
    setting: person ? "a bright, tidy home studio with a plain wall and a plant" : "a full-frame composition built around the visual note",
    lighting: person ? "soft window light from camera-left" : "controlled studio lighting with clear contrast",
    lens: person ? "35mm, shallow depth of field" : "straight-on, everything important in focus",
    texture: person ? "natural skin texture, subtle film grain" : "clean polished surfaces and crisp interface shapes",
    continuity: person ? "same clothing, same light direction and same room in every frame" : "same palette, materials, lighting and interface style in every frame",
    ...(isGraphicNote(note) ? { graphic: true } : {}),
    avoid: person ? ["text", "extra people", "watermark"] : ["text", "people", "presenter", "hands", "watermark"], aspect: portrait ? "9:16" : "16:9",
  };
}
