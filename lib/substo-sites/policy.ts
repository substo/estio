/** First-party public routes only; no custom domain or public authentication surfaces. */
const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PUBLIC_PATH = new RegExp(`^/sites/(${SEGMENT})(?:/(?:blog(?:/${SEGMENT})?|${SEGMENT}|sitemap\\.xml))?$`);
export function isSubstoSitePath(path: string): boolean { return PUBLIC_PATH.test(path); }
export function siteSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  return slug.length >= 3 && slug.length <= 63 && new RegExp(`^${SEGMENT}$`).test(slug) ? slug : null;
}
export const sitePath = (slug: string) => `/sites/${encodeURIComponent(slug)}`;

export type WebsiteSettings = { title: string; description: string; email: string; accent: string; logoUrl: string };
export function websiteSettings(value: unknown, fallbackName = "Our brand"): WebsiteSettings {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: string, max: number) => typeof data[key] === "string" ? (data[key] as string).trim().slice(0, max) : "";
  const email = text("email", 254);
  return {
    title: text("title", 150) || fallbackName,
    description: text("description", 1000),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    accent: /^#[0-9a-f]{6}$/i.test(text("accent", 7)) ? text("accent", 7) : "#111827",
    logoUrl: safeImageUrl(text("logoUrl", 2048)) ?? "",
  };
}
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function siteLink(value: unknown, slug: string): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x20\\]/.test(value)) return null;
  if (value.startsWith("#")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) {
    const url = new URL(value, "https://site.invalid");
    // Rebase editor-authored root links into this website, including dot segments.
    return `${sitePath(slug)}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  }
  try {
    const url = new URL(value);
    return ["https:", "mailto:", "tel:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
