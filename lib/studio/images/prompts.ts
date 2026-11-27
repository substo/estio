import type { PromptDialect } from "./catalog";

/**
 * One storyboard frame as a director would describe it, written down once and rendered in the wording each model family answers best.
 * The structure follows what performs across the major models: a clear shot (size, angle, lens), one visible action, concrete light,
 * continuity anchors, and no filler adjectives. A locked `character` block is repeated verbatim in every frame so the person stays the same.
 */
export const SHOT_SIZES = ["extreme wide", "wide", "medium", "medium close-up", "close-up", "extreme close-up", "over-the-shoulder", "point-of-view"] as const;
export const SHOT_ANGLES = ["eye-level", "low-angle", "high-angle", "top-down", "dutch angle"] as const;
export type ShotSize = typeof SHOT_SIZES[number];
export type ShotAngle = typeof SHOT_ANGLES[number];

export interface ShotText { quote: string; placement?: string; style?: string }
export interface ShotSpec {
  size: ShotSize; angle: ShotAngle;
  /** What happens in this frame: one visible action, mid-action rather than a static pose ("already mid-stride, turning toward the door"). */
  subject: string;
  /** The locked description of the person, identical in every frame ("the man in the reference photo, short dark hair, grey hoodie"). */
  character?: string;
  setting: string; time?: string;
  /** Concrete light: "soft window light from camera-left", "single tungsten key", "golden-hour backlight". */
  lighting?: string;
  /** Lens and depth of field: "35mm, shallow depth of field". */
  lens?: string;
  /** Realism anchors: "visible skin pores, fabric weave, Kodak Portra 400 grain". */
  texture?: string; palette?: string;
  /** What must match the previous frame: wardrobe, time of day, light direction. */
  continuity?: string;
  /** Exact text that must appear (signs, titles); only models that render text are given it. */
  text?: ShotText[];
  /** Things that must not appear, as plain nouns ("extra people", "watermark"). */
  avoid?: string[];
  /** A screen, interface or motion-graphic frame with no person: drawn flat, never a photo of the creator. */
  graphic?: boolean;
  aspect: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
}

export interface RenderedPrompt { prompt: string; negative?: string; aspect: ShotSpec["aspect"]; notes: string[] }

/** Empty quality words are ignored or make output worse on modern models; concrete visible detail wins. They are removed, and the user is told. */
const FILLER = /\b(masterpiece|best quality|high quality|ultra[- ]?detailed|highly detailed|hyper[- ]?detailed|8k|4k|uhd|trending on artstation|award[- ]winning|beautiful|stunning|breathtaking|gorgeous|epic|perfect|amazing)\b[,]?/gi;
const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:\s]+$/, "");
export function stripFiller(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text.replace(FILLER, m => { removed.push(m.replace(/,$/, "").toLowerCase()); return ""; }).replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^[,\s]+|[,\s]+$/g, "");
  return { text: out, removed };
}
const sentence = (text: string | undefined) => { const t = clean(text); return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ""; };
const cap = (text: string) => text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
const shotPhrase = (s: ShotSpec) => `${s.size} shot, ${s.angle}`;

export const DEFAULT_NEGATIVE = "blurry, low quality, deformed hands, extra fingers, extra limbs, watermark, text, logo, duplicate person";
const quotes = (items: ShotText[] | undefined) => (items ?? []).filter(t => clean(t.quote)).map(t => `the exact text "${clean(t.quote)}"${t.placement ? ` ${clean(t.placement)}` : ""}${t.style ? `, ${clean(t.style)} lettering` : ""}`);

/** Renders one shot for a prompt dialect. Always returns notes saying what was changed, so nothing is silently dropped. */
export function renderShot(shot: ShotSpec, dialect: PromptDialect, options: { acceptsText?: boolean; negative?: boolean } = {}): RenderedPrompt {
  const notes: string[] = [];
  const fields = { subject: shot.subject, setting: shot.setting, time: shot.time, lighting: shot.lighting, lens: shot.lens, texture: shot.texture, palette: shot.palette, continuity: shot.continuity, character: shot.character } as const;
  const f: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const stripped = stripFiller(clean(value as string | undefined));
    f[key] = stripped.text;
    if (stripped.removed.length) notes.push(`Removed filler words from ${key}: ${[...new Set(stripped.removed)].join(", ")}.`);
  }
  const avoid = (shot.avoid ?? []).map(clean).filter(Boolean);
  const texts = quotes(shot.text);
  if (texts.length && options.acceptsText === false) notes.push("This model does not draw text reliably, so the quoted text was left out. Add it as a title in the editor.");

  if (dialect === "tags") {
    // Subject first, short phrases, key terms lightly weighted; the negative prompt carries the "no" list.
    const parts = [f.character ? `${f.character}, ${f.subject}` : f.subject, shotPhrase(shot), f.setting, f.time, f.lighting, f.lens, f.texture, f.palette, f.continuity].filter(Boolean);
    const prompt = parts.map((p, i) => i === 0 ? `(${p}:1.2)` : p).join(", ");
    const negative = [...new Set([DEFAULT_NEGATIVE, ...avoid])].join(", ");
    return { prompt, negative, aspect: shot.aspect, notes };
  }

  if (dialect === "edit" && shot.graphic) {
    const look = "Dark minimal phone and app screens, one accent colour, rounded UI elements, clean flat vector style, the same look in every frame.";
    return { prompt: [cap(`Draw a flat motion-graphic frame, not a photograph: ${f.subject}.`), look, "Do not show any person, face or hand, and ignore the person in the reference image.", "No text except a few short UI labels."].join(" "), aspect: shot.aspect, notes };
  }
  if (dialect === "edit") {
    // An instruction to an editing model: name the person by description (never "she/he"), say what to keep, then describe the new frame.
    const who = f.character || "the person in the reference image";
    const keep = `Keep ${who}'s face, hairstyle and clothing exactly the same as in the reference image.`;
    const scene = `Show ${who} ${f.subject} as a ${shotPhrase(shot)}, ${f.setting}${f.time ? `, ${f.time}` : ""}.`;
    const look = [sentence(f.lighting), f.lens ? sentence(`Shot on ${f.lens}`) : "", sentence(f.texture), sentence(f.palette)].filter(Boolean).join(" ");
    const cont = f.continuity ? sentence(`Match the previous frame: ${f.continuity}`) : "";
    const no = avoid.length ? sentence(`No ${avoid.join(", no ")}`) : "";
    const withText = options.acceptsText !== false && texts.length ? sentence(`Include ${texts.join(" and ")}`) : "";
    return { prompt: [cap(scene), keep, look, cont, withText, no].filter(Boolean).join(" "), aspect: shot.aspect, notes };
  }

  if (dialect === "ideogram") {
    // Exact text first, with its placement, then a simple scene so the lettering has room.
    const lead = options.acceptsText !== false && texts.length ? sentence(`${cap(texts.join(" and "))}`) : "";
    const scene = `${cap(shotPhrase(shot))} of ${f.character ? `${f.character}, ` : ""}${f.subject}, ${f.setting}${f.time ? `, ${f.time}` : ""}.`;
    const look = [sentence(f.lighting), f.lens ? sentence(`Shot on ${f.lens}`) : "", sentence(f.texture), sentence(f.palette), sentence(f.continuity)].filter(Boolean).join(" ");
    return { prompt: [lead, scene, look].filter(Boolean).join(" "), negative: options.negative && avoid.length ? avoid.join(", ") : undefined, aspect: shot.aspect, notes };
  }

  // natural: Flux, GPT Image, Gemini, Qwen. One flowing description in the order that works: shot, subject and action, place and time, light, lens, texture, palette, continuity.
  const opening = `${cap(shotPhrase(shot))} of ${f.character ? `${f.character}, ` : ""}${f.subject}.`;
  const place = sentence([f.setting, f.time].filter(Boolean).join(", "));
  const lens = f.lens ? sentence(`Shot on ${f.lens}`) : "";
  const cont = f.continuity ? sentence(`Continuity: ${f.continuity}`) : "";
  const withText = options.acceptsText !== false && texts.length ? sentence(`Include ${texts.join(" and ")}`) : "";
  const no = avoid.length ? sentence(`Frame contains no ${avoid.join(", no ")}`) : "";
  const prompt = [opening, place, sentence(f.lighting), lens, sentence(f.texture), sentence(f.palette), cont, withText, no].filter(Boolean).join(" ");
  const words = prompt.split(/\s+/).length;
  if (words > 140) notes.push(`This prompt is ${words} words. These models do best with 30 to 100: one clear shot, not a mood board.`);
  return { prompt, aspect: shot.aspect, notes };
}

/** The default storyboard look: a clear, photographic frame, not a stylised one. */
export const SAMPLE_SHOT: ShotSpec = {
  size: "medium", angle: "eye-level", subject: "already mid-stride, turning toward a studio door with a coffee in one hand",
  character: "the man in the reference photo, short dark hair, grey hoodie", setting: "a small podcast studio with acoustic panels", time: "late afternoon",
  lighting: "soft window light from camera-left", lens: "35mm, shallow depth of field", texture: "visible fabric weave, subtle film grain", continuity: "same grey hoodie, light from camera-left",
  avoid: ["extra people", "text"], aspect: "16:9",
};
