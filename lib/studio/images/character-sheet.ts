/**
 * The creator's character, from their own photos: a locked CHARACTER CARD (text) and reference SHEETS (pictures) that every storyboard frame is drawn from.
 * Built from what works for consistent characters: lock identity first and change one thing at a time; describe from the photos, then edit that description;
 * a plain neutral layout with even light; real photos in, several angles; one view at a time when something drifts. The people in the photos are the
 * creator's own: they are sent only to the engine the creator chose, only when they generate.
 */
export const MAX_CHARACTER_PHOTOS = 5;
export const PHOTO_ROLES = ["face-front", "face-angle", "full-body", "outfit", "other"] as const;
export type PhotoRole = typeof PHOTO_ROLES[number];
export const PHOTO_ROLE_LABELS: Record<PhotoRole, string> = { "face-front": "Face, front-on", "face-angle": "Face, three-quarter angle", "full-body": "Full body", outfit: "Outfit you want to keep", other: "Another good photo" };
/** What makes a reference photo good, shown next to the upload. */
export const PHOTO_TIPS = ["Sharp and evenly lit, plain background", "One person only: you", "No sunglasses, masks or heavy filters", "Different angles help: front, three-quarter, full body"];

export const ASPECT_KEYS = ["hair", "facial hair", "glasses", "build", "skin and age", "clothing", "accessories", "style"] as const;
export type AspectKey = typeof ASPECT_KEYS[number];
/** One thing about the person. `locked` aspects are repeated verbatim in every picture; unlocked ones are free to change (the clothing, the glasses). */
export interface CharacterAspect { key: AspectKey; value: string; locked: boolean }
export interface CharacterProfile { aspects: CharacterAspect[]; /** Anything else that must stay true, in the creator's words. */ notes?: string }

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:\s]+$/, "");

/** The character card: one short block, identical in every picture. Locked aspects only; the rest are chosen per scene. */
export function characterCard(profile: CharacterProfile): string {
  const locked = profile.aspects.filter(a => a.locked && clean(a.value)).map(a => `${a.key}: ${clean(a.value)}`);
  const notes = clean(profile.notes);
  return `the person in the reference photos${locked.length ? `, ${locked.join("; ")}` : ""}${notes ? `; ${notes}` : ""}`;
}
/** The aspects the creator leaves free (usually clothing), as a plain phrase for a scene or a sheet. */
export function freeAspects(profile: CharacterProfile): string {
  return profile.aspects.filter(a => !a.locked && clean(a.value)).map(a => `${a.key}: ${clean(a.value)}`).join("; ");
}

export type SheetKind = "turnaround" | "expressions" | "outfits" | "face";
export const SHEET_LABELS: Record<SheetKind, string> = { turnaround: "Turnaround (front, angles, side, back)", expressions: "Expressions", outfits: "Outfits", face: "Face close-ups" };

const NEUTRAL = "on a plain light-grey studio background, even soft frontal light, no shadows on the background, no text, no labels, no other people";
const SAME = "Keep the exact same face, hairstyle, skin tone and proportions as in the reference photos in every panel";
/** The prompt for one sheet. The reference photos are attached by the caller; the prompt never describes the face from memory, it points at them. */
export function sheetPrompt(kind: SheetKind, profile: CharacterProfile, options: { outfit?: string; outfits?: string[] } = {}): string {
  const card = characterCard(profile), free = freeAspects(profile);
  const wearing = options.outfit ? ` wearing ${clean(options.outfit)}` : free ? ` (${free})` : "";
  switch (kind) {
    case "turnaround":
      return `Character reference sheet, ${NEUTRAL}. A full-body turnaround of ${card}${wearing}: five views in one row, left to right: front, three-quarter left, left side, three-quarter right, back. Standing relaxed in a neutral A-pose, same height and the same clothing in every view, arms slightly away from the body so the outfit is visible. ${SAME}.`;
    case "expressions":
      return `Character expression sheet, ${NEUTRAL}. A 3 by 3 grid of head-and-shoulders portraits of ${card}${wearing}: neutral, warm smile, laughing, surprised, thinking, concerned, confident, mid-sentence speaking, looking down. Same lighting, same framing and same head size in every panel. ${SAME}.`;
    case "face":
      return `Character face sheet, ${NEUTRAL}. Four tight head portraits of ${card}: front, three-quarter left, three-quarter right, left profile. Sharp focus, natural skin texture, same lighting in every panel. ${SAME}.`;
    case "outfits": {
      const list = (options.outfits ?? []).map(clean).filter(Boolean).slice(0, 4);
      const each = list.length ? list.map((o, i) => `${i + 1}. ${o}`).join("; ") : "casual, smart-casual, on-camera presenter look";
      return `Character outfit sheet, ${NEUTRAL}. ${list.length || 3} full-body panels of ${card}, each in a different outfit: ${each}. Same pose, same height and same face in every panel, front-on. ${SAME}.`;
    }
  }
}
/** One view at a time, for when a sheet drifts: regenerate just this panel from the references and the card. */
export const SINGLE_VIEWS = ["front", "three-quarter left", "left side", "three-quarter right", "back"] as const;
export function singleViewPrompt(view: typeof SINGLE_VIEWS[number], profile: CharacterProfile, outfit?: string): string {
  return `Single full-body reference picture, ${NEUTRAL}. ${characterCard(profile)}${outfit ? ` wearing ${clean(outfit)}` : ""}, standing in a neutral A-pose, ${view} view. ${SAME}.`;
}

/** What the agent can change, as plain instructions applied to the profile (the agent chat edits aspects; the pictures are then regenerated from them). */
export type ProfileEdit = { op: "set"; key: AspectKey; value: string; locked?: boolean } | { op: "remove"; key: AspectKey } | { op: "lock"; key: AspectKey; locked: boolean } | { op: "notes"; value: string };
export function applyProfileEdits(profile: CharacterProfile, edits: ProfileEdit[]): CharacterProfile {
  let aspects = [...profile.aspects], notes = profile.notes;
  for (const e of edits.slice(0, 20)) {
    if (e.op === "notes") { notes = clean(e.value).slice(0, 400) || undefined; continue; }
    if (!(ASPECT_KEYS as readonly string[]).includes(e.key)) continue;
    const i = aspects.findIndex(a => a.key === e.key);
    if (e.op === "remove") { if (i >= 0) aspects.splice(i, 1); }
    else if (e.op === "lock") { if (i >= 0) aspects[i] = { ...aspects[i], locked: e.locked }; }
    else { const value = clean(e.value).slice(0, 200), locked = e.locked ?? (i >= 0 ? aspects[i].locked : !["clothing", "accessories", "glasses"].includes(e.key)); if (!value) continue; if (i >= 0) aspects[i] = { key: e.key, value, locked }; else aspects.push({ key: e.key, value, locked }); }
  }
  return { aspects: aspects.slice(0, 12), ...(notes ? { notes } : {}) };
}
