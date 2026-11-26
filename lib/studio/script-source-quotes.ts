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
