/** A bounded, read-only picture of the Mac's `substo timeline --json`, saved with each exported version. Short keys keep 200 clips well under the 24 KB bound. */
export interface TimelineClip { s: number; e: number; l: string; k: string }
export interface TimelineTrack { n: string; k: "video" | "audio"; c: TimelineClip[] }
export interface TimelineSnapshot { d: number; tracks: TimelineTrack[] }
export const TIMELINE_MAX_CLIPS = 200;
export const TIMELINE_MAX_BYTES = 24_000;
const round = (n: number) => Math.round(n * 100) / 100;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

function clipOf(raw: unknown): TimelineClip | null {
  if (!record(raw)) return null;
  const start = Number(raw.start), duration = Number(raw.duration);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || start < 0 || start > 36_000) return null;
  const content = record(raw.content) ? raw.content : {};
  const kind = Object.keys(content)[0] ?? "clip";
  const text = record(content.text) ? clean(content.text.text, 28) : "";
  return { s: round(start), e: round(start + duration), l: clean(raw.name, 28) || text || kind, k: clean(kind, 12) || "clip" };
}
/** Input is the `project` object of `substo timeline --json`. Video tracks are listed bottom-to-top there; the picture shows them top-to-bottom like the app, then the audio tracks. */
export function reduceTimeline(project: unknown): TimelineSnapshot | null {
  if (!record(project)) return null;
  const video = Array.isArray(project.videoTracks) ? [...project.videoTracks].reverse() : [], audio = Array.isArray(project.audioTracks) ? project.audioTracks : [];
  let budget = TIMELINE_MAX_CLIPS, d = 0;
  const tracks: TimelineTrack[] = [];
  for (const [kind, list] of [["video", video], ["audio", audio]] as const) for (const t of list) {
    if (!record(t)) continue;
    const clips = (Array.isArray(t.clips) ? t.clips : []).map(clipOf).filter((c): c is TimelineClip => c !== null).sort((a, b) => a.s - b.s).slice(0, Math.max(0, budget));
    budget -= clips.length; for (const c of clips) d = Math.max(d, c.e);
    tracks.push({ n: clean(t.name, 24) || kind, k: kind, c: clips });
    if (tracks.length >= 16) break;
  }
  const snapshot = { d: round(d), tracks };
  return new TextEncoder().encode(JSON.stringify(snapshot)).length <= TIMELINE_MAX_BYTES ? snapshot : null;
}
export function isTimelineSnapshot(v: unknown): v is TimelineSnapshot {
  if (!record(v) || typeof v.d !== "number" || !Array.isArray(v.tracks) || v.tracks.length > 16) return false;
  let clips = 0;
  return v.tracks.every(t => record(t) && typeof t.n === "string" && (t.k === "video" || t.k === "audio") && Array.isArray(t.c)
    && t.c.every(c => { clips++; return record(c) && typeof c.s === "number" && typeof c.e === "number" && c.e >= c.s && typeof c.l === "string" && typeof c.k === "string"; })) && clips <= TIMELINE_MAX_CLIPS;
}
export const formatTime = (s: number) => `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, "0")}`;
/** Percent offsets inside a row of `duration` seconds; a clip never renders narrower than 0.6%. */
export const layoutClip = (c: TimelineClip, duration: number) => duration > 0 ? { left: Math.min(99.4, (c.s / duration) * 100), width: Math.max(0.6, ((c.e - c.s) / duration) * 100) } : { left: 0, width: 0 };
