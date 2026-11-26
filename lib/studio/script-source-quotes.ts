import { canonicalYoutubeVideo } from "./video-transcription-policy";
import { recordLinkId } from "./record-link-policy";

export type SourceQuote = { asset: string; start: number; end: number; credit: string; url?: string };
export const SOURCE_QUOTE_PREFIX = "Source clip: ";
export const MAX_SOURCE_QUOTES = 12;

export function sourceQuoteSeconds(input: string): number | null {
  const value = input.trim();
  if (/^\d{1,5}(?:\.\d{1,3})?$/.test(value)) return Number(value);
  const clock = /^(\d{1,3}):([0-5]\d(?:\.\d{1,3})?)$/.exec(value);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : null;
}

export function validateSourceQuote(raw: unknown): SourceQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const { asset, start, end, credit, url } = raw as Partial<SourceQuote>;
  if (typeof asset !== "string" || !recordLinkId(asset) || typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 43_200 ||
      end - start < 0.25 || end - start > 120 || typeof credit !== "string" || !credit.trim() || credit.length > 120 ||
      /[\[\]\u0000-\u001f\u007f]/.test(credit)) return null;
  if (url !== undefined) {
    if (typeof url !== "string" || url.length > 500 || /[\[\]\s]/.test(url)) return null;
    try {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password) return null;
    } catch { return null; }
  }
  return { asset: asset.toLowerCase(), start, end, credit: credit.trim(), ...(url ? { url } : {}) };
}

export function readSourceQuoteCue(text: string): SourceQuote | null {
  const cue = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  if (!cue.startsWith(SOURCE_QUOTE_PREFIX)) return null;
  try { return validateSourceQuote(JSON.parse(cue.slice(SOURCE_QUOTE_PREFIX.length))); }
  catch { return null; }
}

export const sourceQuoteCue = (quote: SourceQuote) => SOURCE_QUOTE_PREFIX + JSON.stringify(quote);

/** A saved citation can point to a whole transcript unit, a frame, or text without timing. */
export type SourceClipTimingStatus = "needed" | "queued" | "running" | "failed" | "unmatched";

export type SourceClipReference = {
  key: string; title: string; quote: string; url: string | null; passageHref: string;
  start: number | null; end: number | null; frameHref: string | null; onScreen: boolean;
  timing?: { sourceId: string; status: SourceClipTimingStatus };
};

export function citationClipRange(start: unknown, end: unknown, onScreen: boolean) {
  const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 43_200
    ? Math.round(value * 1000) / 1000 : null;
  const from = seconds(start), to = seconds(end);
  return { start: from, end: !onScreen && from !== null && to !== null && to - from >= 0.25 && to - from <= 120 ? to : null };
}

/** A preview uses whole seconds. Keep the saved cut bounds at their original precision. */
export function sourceClipPlayback(url: string | null, start: number | null, end: number | null) {
  const video = canonicalYoutubeVideo(url);
  if (!video) return null;
  const watch = new URL(video.url);
  const params = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0" });
  const range = citationClipRange(start, end, false);
  if (range.start !== null) {
    const at = String(Math.floor(range.start));
    watch.searchParams.set("t", at + "s");
    params.set("start", at);
  }
  if (range.end !== null) params.set("end", String(Math.ceil(range.end)));
  return { watch: watch.href, embed: `https://www.youtube-nocookie.com/embed/${video.videoId}?${params}` };
}

/** Recover a segment range for a legacy quote only when it uniquely matches the timed transcript. */
export function matchTimedSourceQuote(quote: string, segments: readonly { text: string; start: number; end: number }[]) {
  const normalize = (value: string) => (value.normalize("NFC").replace(/[’‘]/g, "'").toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu) ?? []).join(" ");
  const needle = normalize(quote);
  if (needle.length < 24) return null;
  const pieces: string[] = [];
  const offsets: { from: number; to: number; start: number; end: number }[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const part = normalize(segment.text);
    if (!part) continue;
    offsets.push({ from: cursor, to: cursor + part.length, start: segment.start, end: segment.end });
    pieces.push(part);
    cursor += part.length + 1;
  }
  const text = ` ${pieces.join(" ")} `;
  const phrase = ` ${needle} `;
  const match = text.indexOf(phrase);
  if (match === -1 || text.indexOf(phrase, match + 1) !== -1) return null;
  const first = offsets.find(unit => unit.from <= match && match < unit.to);
  const last = offsets.find(unit => unit.from < match + needle.length && match + needle.length <= unit.to);
  const range = citationClipRange(first?.start, last?.end, false);
  return range.start !== null && range.end !== null ? range : null;
}
