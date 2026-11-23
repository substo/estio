/** Pure voice-library rules: tag facets, local speaker descriptors, availability and quick filtering. Shared by the page, the agent tools and tests. */
import { LOCAL_SPEAKERS, type VoiceProvider } from "./policy";

export const TAG_FACETS = ["gender", "age", "tone", "use", "accent"] as const;
export type TagFacet = typeof TAG_FACETS[number];
export const facetLabels: Record<TagFacet, string> = { gender: "Gender", age: "Age", tone: "Tone", use: "Use", accent: "Accent" };

/** A tag is `facet:value`, lowercase, snake_case value. Anything else a provider sends is dropped. */
export function normalizeTag(facet: string, value: unknown): string | null {
  if (!TAG_FACETS.includes(facet as TagFacet) || typeof value !== "string") return null;
  const v = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return v ? `${facet}:${v}` : null;
}
export const tagLabel = (tag: string) => { const [, v = ""] = tag.split(":"); return v.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()); };
export const tagFacet = (tag: string): TagFacet | null => { const f = tag.split(":")[0]; return TAG_FACETS.includes(f as TagFacet) ? f as TagFacet : null; };
const unique = (tags: Array<string | null>) => [...new Set(tags.filter((t): t is string => !!t))].slice(0, 12);

/** ElevenLabs `labels` (accent, descriptive, age, gender, use_case) become tags; `description` stays prose. */
export function elevenLabsMeta(voice: Record<string, unknown>): { description: string | null; tags: string[] } {
  const labels = (voice.labels && typeof voice.labels === "object" ? voice.labels : {}) as Record<string, unknown>;
  const description = typeof voice.description === "string" ? voice.description.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : "";
  return { description: description || null, tags: unique([normalizeTag("gender", labels.gender), normalizeTag("age", labels.age), normalizeTag("tone", labels.descriptive),
    normalizeTag("use", labels.use_case), normalizeTag("accent", labels.accent)]) };
}
/** Fish returns free-form `tags` and a `description`; tags that name a known facet value are mapped, the rest become tone tags. Field names are read defensively (not confirmed against Fish's OpenAPI). */
const FISH_GENDER = new Set(["male", "female"]);
const FISH_AGE = new Set(["young", "middle_aged", "old", "elderly"]);
export function fishMeta(item: Record<string, unknown>): { description: string | null; tags: string[] } {
  const raw = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : [];
  const tags = raw.map(t => {
    const v = t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return FISH_GENDER.has(v) ? normalizeTag("gender", v) : FISH_AGE.has(v) ? normalizeTag("age", v) : normalizeTag("tone", v);
  });
  const description = typeof item.description === "string" ? item.description.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : "";
  return { description: description || null, tags: unique(tags) };
}

/** Built-in Qwen3-TTS CustomVoice speakers. Hand-written from the model card; the model has no metadata API. */
export const LOCAL_SPEAKER_CATALOG: Record<typeof LOCAL_SPEAKERS[number], { description: string; tags: string[]; language: string }> = {
  serena: { description: "Warm, gentle young woman. Soft and reassuring.", tags: ["gender:female", "age:young", "tone:warm", "tone:soft", "use:narration"], language: "zh" },
  vivian: { description: "Bright, slightly edgy young woman. Clear and lively.", tags: ["gender:female", "age:young", "tone:bright", "use:social"], language: "zh" },
  uncle_fu: { description: "Seasoned man with a low, mellow voice. Calm and mature.", tags: ["gender:male", "age:old", "tone:calm", "tone:deep", "use:narration"], language: "zh" },
  ryan: { description: "Dynamic man with a strong rhythm. Energetic and punchy.", tags: ["gender:male", "age:young", "tone:energetic", "use:social"], language: "en" },
  aiden: { description: "Sunny American man. Friendly and clear.", tags: ["gender:male", "age:young", "tone:friendly", "accent:american", "use:conversational"], language: "en" },
  ono_anna: { description: "Playful Japanese woman. Light and expressive.", tags: ["gender:female", "age:young", "tone:playful", "accent:japanese"], language: "ja" },
  sohee: { description: "Warm Korean woman. Soft and kind.", tags: ["gender:female", "age:middle_aged", "tone:warm", "tone:soft", "accent:korean"], language: "ko" },
  eric: { description: "Lively man with a Sichuan-Mandarin lilt. Expressive.", tags: ["gender:male", "age:young", "tone:lively", "accent:sichuan"], language: "zh" },
  dylan: { description: "Youthful man with a Beijing accent. Casual and clear.", tags: ["gender:male", "age:young", "tone:casual", "accent:beijing"], language: "zh" },
};

export interface LibraryVoice { id: string; provider: VoiceProvider; providerVoiceId: string; name: string; kind: "preset" | "clone" | "designed"; language: string | null;
  persona: string | null; isDefault: boolean; description?: string | null; tags?: string[] }
export type LocalState = "ready" | "not_installed" | "mac_offline";
export interface Availability { fish: boolean; elevenlabs: boolean; local: LocalState }
export type VoiceStatus = { usable: true } | { usable: false; need: "key" | "install" | "mac"; message: string };

export function voiceStatus(voice: Pick<LibraryVoice, "provider">, a: Availability): VoiceStatus {
  if (voice.provider === "local") {
    if (a.local === "ready") return { usable: true };
    return a.local === "mac_offline"
      ? { usable: false, need: "mac", message: "Your Mac is offline. Start the companion to use on-device voices." }
      : { usable: false, need: "install", message: "Install the voice model under Devices." };
  }
  return a[voice.provider] ? { usable: true } : { usable: false, need: "key", message: `Add your ${voice.provider === "fish" ? "Fish Audio" : "ElevenLabs"} key in Settings → AI.` };
}

export type QuickFilter = "available" | "local" | "hosted" | "cloned" | "needs_key";
export const quickFilterLabels: Record<QuickFilter, string> = { available: "Available", local: "On this Mac", hosted: "Hosted", cloned: "Cloned", needs_key: "Needs a key" };
export interface VoiceQuery { text?: string; quick?: QuickFilter[]; tags?: string[] }

/** Words of the query must each appear in the name, description, persona, provider or a tag label. Quick filters are AND-ed; tags of one facet are OR-ed, facets AND-ed. */
export function filterVoices<T extends LibraryVoice>(voices: T[], a: Availability, q: VoiceQuery): T[] {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const byFacet = new Map<string, string[]>();
  for (const t of q.tags ?? []) { const f = t.split(":")[0]; byFacet.set(f, [...(byFacet.get(f) ?? []), t]); }
  const quick = q.quick ?? [];
  return voices.filter(v => {
    const st = voiceStatus(v, a);
    for (const f of quick) {
      if (f === "available" && !st.usable) return false;
      if (f === "local" && v.provider !== "local") return false;
      if (f === "hosted" && v.provider === "local") return false;
      if (f === "cloned" && v.kind === "preset") return false;
      if (f === "needs_key" && !(st.usable === false && st.need === "key")) return false;
    }
    for (const [, group] of byFacet) if (!group.some(t => v.tags?.includes(t))) return false;
    if (!words.length) return true;
    const hay = [v.name, v.description ?? "", v.persona ?? "", v.provider, v.language ?? "", ...(v.tags ?? []).map(tagLabel)].join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
/** Facet values present in the list, with counts, for the chip rows. */
export function facetCounts(voices: LibraryVoice[]): Array<{ facet: TagFacet; values: Array<{ tag: string; count: number }> }> {
  return TAG_FACETS.flatMap(facet => {
    const m = new Map<string, number>();
    for (const v of voices) for (const t of v.tags ?? []) if (tagFacet(t) === facet) m.set(t, (m.get(t) ?? 0) + 1);
    const values = [...m].map(([tag, count]) => ({ tag, count })).sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag)).slice(0, 8);
    return values.length ? [{ facet, values }] : [];
  });
}
/** Usable voices first (default first), then those still needing a key / install. */
export function splitByAvailability<T extends LibraryVoice>(voices: T[], a: Availability): { usable: T[]; unavailable: T[] } {
  const usable = voices.filter(v => voiceStatus(v, a).usable).sort((x, y) => Number(y.isDefault) - Number(x.isDefault));
  return { usable, unavailable: voices.filter(v => !voiceStatus(v, a).usable) };
}

/** Voice Design prompt: structured fields first, as ElevenLabs recommends, then free text. Avoids the word "accent" for delivery. */
export interface DesignFields { gender: string; age: string; accent: string; tone: string; pace: string; notes: string }
export const DESIGN_MIN = 20, DESIGN_MAX = 1000;
export function buildDesignPrompt(f: DesignFields): string {
  const clean = (x: string) => x.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const who = [clean(f.age), clean(f.gender)].filter(Boolean).join(" ") || "voice";
  const sentences = [`A ${who}${clean(f.accent) ? ` with a ${clean(f.accent)} accent` : ""}.`, clean(f.tone) ? `Tone: ${clean(f.tone)}.` : "", clean(f.pace) ? `Pace: ${clean(f.pace)}.` : "", clean(f.notes)];
  const text = sentences.filter(Boolean).join(" ");
  return (/[.!?]$/.test(text) ? text : `${text}.`).slice(0, DESIGN_MAX);
}
export const designError = (prompt: string) => prompt.length < DESIGN_MIN ? `Describe the voice in at least ${DESIGN_MIN} characters.` : prompt.length > DESIGN_MAX ? `Keep the description under ${DESIGN_MAX} characters.` : null;

/** Passages read aloud when recording a sample: varied sentences, ~1.5 minutes together at a natural pace. */
export const SAMPLE_PASSAGES = [
  "Hi, welcome back. Today I want to show you something that saved me a lot of time, and I think it will do the same for you. Let me walk you through it step by step.",
  "There are three things to remember. First, keep it simple. Second, show, don't tell. And third, always give people a reason to keep watching until the very end.",
  "Honestly, I was surprised how well it worked! Numbers like four hundred and twenty, or the twelfth of March, should sound natural. Thanks for watching, and I'll see you in the next one.",
] as const;
export const RECORDING_TIPS = ["Use a quiet room and keep the same distance from the mic.", "Speak naturally, as you would to a friend. Don't read in a flat voice.", "Record all three passages without changing microphone or room."];
/** Spoken before the sample: bound to the voice name so the consent recording cannot be reused for another voice. */
export const consentSpeech = (voiceName: string) => `I, speaking now, give permission to create a voice called ${voiceName.trim().slice(0, 60)} from this recording, for use in my workspace's videos.`;
export const MIN_RECORDING_SECONDS = 30;
