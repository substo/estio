import type { FieldKind, FieldValue } from "./topics";

/**
 * Plain-text editing for every field kind, so one inline editor serves all of them: lists are one entry per line and
 * structured entries use "a | b" columns. Client-safe and pure; the server validates what comes back.
 */
export const fieldFormat: Partial<Record<FieldKind, string>> = {
  list: "One per line",
  areas: "One area per line",
  phones: "One per line: label | number, e.g. Office | +357 26 000000",
  maps: "One per line: url | title",
  links: "One per line: platform | url, e.g. Instagram | https://instagram.com/…",
  logos: "One per line: primary, light, icon or favicon | image url",
  colours: "One per line: role | #hex, e.g. primary | #9d0917",
  competitors: "One per line: name | website | notes",
  hours: "One per line: day | 09:00-17:00, or day | closed",
};
export const multiline = (kind: FieldKind) => kind === "longtext" || kind === "address" || kind in fieldFormat;

const cols = (line: string) => line.split("|").map(s => s.trim());
const lines = (text: string) => text.split("\n").map(s => s.trim()).filter(Boolean);
const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A value as text for editing and display; empty string for nothing. */
export function toText(kind: FieldKind, value: FieldValue | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const rows = value as Record<string, unknown>[];
  switch (kind) {
    case "list": case "areas": return (value as string[]).join("\n");
    case "phones": return rows.map(r => r.label ? `${r.label} | ${r.number}` : String(r.number)).join("\n");
    case "maps": return rows.map(r => r.title ? `${r.url} | ${r.title}` : String(r.url)).join("\n");
    case "links": return rows.map(r => `${r.platform} | ${r.url}`).join("\n");
    case "logos": return rows.map(r => `${r.variant} | ${r.url}`).join("\n");
    case "colours": return rows.map(r => `${r.role} | ${r.hex}`).join("\n");
    case "competitors": return rows.map(r => [r.name, r.website ?? "", r.notes ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
    case "hours": return rows.map(r => `${r.day} | ${r.closed ? "closed" : `${r.opens ?? ""}-${r.closes ?? ""}`}`).join("\n");
    default: return JSON.stringify(value);
  }
}

/** Text typed by the owner back into a value; null when empty (clears the field). */
export function fromText(kind: FieldKind, text: string): FieldValue | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  switch (kind) {
    case "list": case "areas": return lines(trimmed);
    case "phones": return lines(trimmed).map(l => { const c = cols(l); return c.length > 1 ? { label: c[0], number: c[1] } : { number: c[0] }; });
    case "maps": return lines(trimmed).map(l => { const [url, title] = cols(l); return title ? { url, title } : { url }; });
    case "links": return lines(trimmed).map(l => { const c = cols(l); return c.length > 1 ? { platform: c[0], url: c[1] } : { platform: platformOf(c[0]), url: c[0] }; });
    case "logos": return lines(trimmed).map(l => { const c = cols(l); return c.length > 1 ? { variant: c[0].toLowerCase(), url: c[1] } : { variant: "primary", url: c[0] }; });
    case "colours": return lines(trimmed).map(l => { const c = cols(l); return c.length > 1 ? { role: c[0], hex: c[1] } : { role: "brand", hex: c[0] }; });
    case "competitors": return lines(trimmed).map(l => { const [name, website, notes] = cols(l); return { name, ...(website ? { website } : {}), ...(notes ? { notes } : {}) }; });
    case "hours": return lines(trimmed).map(l => {
      const [dayText, time = ""] = cols(l), day = dayText.toLowerCase().slice(0, 3);
      if (/closed/i.test(time) || !time) return { day: days.includes(day) ? day : dayText, closed: true };
      const [opens, closes] = time.split(/\s*[-–]\s*/);
      return { day: days.includes(day) ? day : dayText, closed: false, opens, closes };
    });
    case "countryCode": case "currencyCode": return trimmed.toUpperCase();
    default: return trimmed;
  }
}

/** Best guess of the platform from a bare profile URL. */
export function platformOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0] || "website"; } catch { return "website"; }
}

/** How a value reads on screen: like the editing text, but without the "|" column separators. */
function readable(kind: FieldKind, value: FieldValue | null): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  const rows = value as Record<string, string | boolean | undefined>[];
  switch (kind) {
    case "list": case "areas": return value as string[];
    case "phones": return rows.map(r => [r.label, r.number].filter(Boolean).join(" "));
    case "maps": return rows.map(r => r.title ? `${r.title} (${r.url})` : String(r.url));
    case "links": return rows.map(r => `${r.platform}: ${r.url}`);
    case "logos": return rows.map(r => `${r.variant}: ${r.url}`);
    case "colours": return rows.map(r => `${r.role} ${r.hex}`);
    case "competitors": return rows.map(r => r.website ? `${r.name} (${r.website})` : String(r.name));
    case "hours": return rows.map(r => `${r.day} ${r.closed ? "closed" : `${r.opens ?? ""}–${r.closes ?? ""}`}`);
    default: return [toText(kind, value)];
  }
}
/** Short one-line display of a value for chat and summaries. */
export function displayValue(kind: FieldKind, value: FieldValue | null, max = 160) {
  const text = readable(kind, value).join(" · ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
