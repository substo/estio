import { VoiceSettingsError } from "./keys";
import type { DesignFields } from "./library";

const word = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Voice Design input from the browser: short structured fields plus free text, each bounded. */
export function readDesignFields(value: unknown): DesignFields {
  if (!value || typeof value !== "object") throw new VoiceSettingsError("Describe the voice first.");
  const v = value as Record<string, unknown>;
  return { gender: word(v.gender, 20), age: word(v.age, 20), accent: word(v.accent, 40), tone: word(v.tone, 60), pace: word(v.pace, 30), notes: word(v.notes, 500), previewText: word(v.previewText, 1000) };
}
