/** The Voices assistant: plain-language commands turned into the same typed tools the page uses (filter, compare, set default, preview, design). No model call, no cost, no data leaves the browser. */
import { buildDesignPrompt, tagLabel, voiceStatus, type Availability, type DesignFields, type LibraryVoice, type QuickFilter } from "./library";

export type AssistantAction =
  | { kind: "help" }
  | { kind: "filter"; text: string; tags: string[]; quick: QuickFilter[] }
  | { kind: "compare"; ids: string[] }
  | { kind: "default"; id: string }
  | { kind: "preview"; id: string }
  | { kind: "design"; fields: Partial<DesignFields> }
  | { kind: "unknown" };
export interface AssistantTurn { action: AssistantAction; reply: string; voiceIds: string[] }

const SYNONYMS: Record<string, string> = {
  woman: "gender:female", women: "gender:female", female: "gender:female", girl: "gender:female", lady: "gender:female",
  man: "gender:male", men: "gender:male", male: "gender:male", guy: "gender:male",
  young: "age:young", youthful: "age:young", old: "age:old", older: "age:old", elderly: "age:old", mature: "age:old", "middle aged": "age:middle_aged",
  narrator: "use:narration", narration: "use:narration", audiobook: "use:narration", social: "use:social", tiktok: "use:social", youtube: "use:social", conversational: "use:conversational", characters: "use:characters",
};
const ACCENTS = ["british", "american", "irish", "australian", "scottish", "texan", "indian", "canadian", "south african", "new york", "southern"];
const TONES = ["warm", "calm", "soft", "energetic", "deep", "bright", "friendly", "playful", "clear", "casual", "confident", "authoritative", "upbeat", "gentle", "husky", "smooth", "professional", "relaxed", "lively", "dominant", "mellow"];
const base = (name: string) => name.split(/\s[-–—]\s/)[0].trim().toLowerCase();
const has = (msg: string, word: string) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(msg);

function mentioned(msg: string, voices: LibraryVoice[]): LibraryVoice[] {
  return voices.filter(v => { const b = base(v.name); return b.length >= 2 && has(msg, b); });
}
function traitTags(msg: string, voices: LibraryVoice[]): string[] {
  const tags = new Set<string>();
  for (const [word, tag] of Object.entries(SYNONYMS)) if (has(msg, word)) tags.add(tag);
  for (const t of new Set(voices.flatMap(v => v.tags ?? []))) if (has(msg, tagLabel(t).toLowerCase())) tags.add(t);
  return [...tags];
}
function designFields(msg: string): Partial<DesignFields> {
  const out: Partial<DesignFields> = { notes: msg.slice(0, 500) };
  if (/\b(woman|female|girl|lady)\b/.test(msg)) out.gender = "woman"; else if (/\b(man|male|guy)\b/.test(msg)) out.gender = "man";
  if (/\byoung|youthful\b/.test(msg)) out.age = "young"; else if (/\bmiddle[- ]aged\b/.test(msg)) out.age = "middle-aged"; else if (/\bold|older|elderly|mature\b/.test(msg)) out.age = "older";
  const accent = ACCENTS.find(a => has(msg, a)); if (accent) out.accent = accent.replace(/^./, c => c.toUpperCase());
  const tones = TONES.filter(t => has(msg, t)); if (tones.length) out.tone = tones.slice(0, 3).join(" and ");
  if (/\bslow(ly)?\b/.test(msg)) out.pace = "slow"; else if (/\bfast|quick\b/.test(msg)) out.pace = "fast"; else if (/\bmedium pace\b/.test(msg)) out.pace = "medium";
  return out;
}
const list = (voices: LibraryVoice[], max = 3) => voices.slice(0, max).map(v => v.name).join(", ");

export function interpret(input: string, voices: LibraryVoice[], a: Availability): AssistantTurn {
  const msg = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (!msg) return { action: { kind: "unknown" }, reply: "Ask me to find, compare or preview a voice, set a default, or design a new one.", voiceIds: [] };
  if (/^(help|what can you do|how do i)/.test(msg)) return { action: { kind: "help" }, voiceIds: [], reply: "Try: “find a warm female narrator”, “compare Liam and Alice”, “preview Ryan”, “make Alice the default”, “which voices need a key”, or “design a calm British man in his fifties”." };
  const named = mentioned(msg, voices);

  if (/\b(design|create|generate|invent)\b.*\bvoice\b|\bdesign\b/.test(msg) && !named.length) {
    return { action: { kind: "design", fields: designFields(msg) }, voiceIds: [], reply: `I filled in the Design form from your description. Review it under Create a voice → Design, then press Design voice. It uses your ElevenLabs credits: “${buildDesignPrompt({ gender: "", age: "", accent: "", tone: "", pace: "", notes: input.trim() }).slice(0, 120)}”` };
  }
  if (/\bcompare\b|\bdifference between\b|\bvs\.?\b|\bversus\b/.test(msg) && named.length >= 2) {
    const ids = named.slice(0, 3).map(v => v.id);
    return { action: { kind: "compare", ids }, voiceIds: ids, reply: named.slice(0, 3).map(v => `${v.name.split(/\s[-–—]\s/)[0]}: ${v.description ?? "no description"}${v.tags?.length ? ` (${v.tags.map(tagLabel).join(", ")})` : ""}`).join("\n") };
  }
  if (/\bdefault\b/.test(msg) && named.length === 1) {
    const v = named[0], st = voiceStatus(v, a);
    return st.usable ? { action: { kind: "default", id: v.id }, voiceIds: [v.id], reply: `Press “Make default” on ${v.name.split(/\s[-–—]\s/)[0]} to confirm.` }
      : { action: { kind: "unknown" }, voiceIds: [v.id], reply: `${v.name.split(/\s[-–—]\s/)[0]} cannot be the default yet. ${st.message}` };
  }
  if (/\b(preview|listen|play|hear|audition|sample)\b/.test(msg) && named.length >= 1) {
    const v = named[0], st = voiceStatus(v, a);
    return st.usable ? { action: { kind: "preview", id: v.id }, voiceIds: [v.id], reply: `Press Preview on ${v.name.split(/\s[-–—]\s/)[0]} to hear a sample.` }
      : { action: { kind: "unknown" }, voiceIds: [v.id], reply: `${v.name.split(/\s[-–—]\s/)[0]} is not available yet. ${st.message}` };
  }
  const quick: QuickFilter[] = [];
  if (/\b(need|needs|missing|without)\b.*\bkey\b|\bnot connected\b|\bunavailable\b/.test(msg)) quick.push("needs_key");
  else if (/\bavailable\b|\busable\b|\bcan i use\b|\bready\b/.test(msg)) quick.push("available");
  if (/\bon[- ]device\b|\blocal\b|\bfree\b|\bmy mac\b/.test(msg)) quick.push("local");
  if (/\bcloned\b|\bmy own\b|\bmy voice\b/.test(msg)) quick.push("cloned");
  const tags = traitTags(msg, voices);
  if (named.length === 1 && !tags.length && !quick.length) { const v = named[0]; return { action: { kind: "unknown" }, voiceIds: [v.id], reply: `${v.name}${v.description ? `: ${v.description}` : ""}` }; }
  if (tags.length || quick.length || /\b(find|show|search|list|which|recommend|suggest|looking|need|want|best)\b/.test(msg)) {
    const text = tags.length || quick.length ? "" : msg.replace(/\b(find|show|search|list|which|voices?|me|a|an|the|for|that|are|is|recommend|suggest|looking|i|need|want|best)\b/g, " ").replace(/\s+/g, " ").trim();
    const hits = voices.filter(v => {
      if (quick.includes("needs_key") && !(voiceStatus(v, a).usable === false && (voiceStatus(v, a) as { need: string }).need === "key")) return false;
      if (quick.includes("available") && !voiceStatus(v, a).usable) return false;
      if (quick.includes("local") && v.provider !== "local") return false;
      if (quick.includes("cloned") && v.kind === "preset") return false;
      const byFacet = new Map<string, string[]>(); for (const t of tags) byFacet.set(t.split(":")[0], [...(byFacet.get(t.split(":")[0]) ?? []), t]);
      for (const [, g] of byFacet) if (!g.some(t => v.tags?.includes(t))) return false;
      return !text || [v.name, v.description ?? "", ...(v.tags ?? []).map(tagLabel)].join(" ").toLowerCase().includes(text);
    });
    const usable = hits.filter(v => voiceStatus(v, a).usable);
    return { action: { kind: "filter", text, tags, quick }, voiceIds: (usable.length ? usable : hits).slice(0, 3).map(v => v.id),
      reply: hits.length ? `${hits.length} match${hits.length === 1 ? "" : "es"}${usable.length < hits.length ? `, ${usable.length} available now` : ""}. Top: ${list(usable.length ? usable : hits)}. I applied the filters to the list.` : "No voice matches. Try fewer traits, or design one with “design a …”." };
  }
  return { action: { kind: "unknown" }, voiceIds: [], reply: "I can find, compare, preview and set default voices, or fill in the Design form. Say “help” for examples." };
}
