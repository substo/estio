const MAX_URLS = 12;
const MAX_ALLOWED_DOMAINS = 25;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

export function extractHttpUrls(text: string): string[] {
  const matches = normalizeText(text).match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return uniqueStrings(matches.map((url) => url.replace(/[.,;:!?]+$/g, ""))).slice(0, MAX_URLS);
}

export function hostnameFromUrl(raw: string | null | undefined): string | null {
  const value = normalizeText(raw);
  if (!value) return null;
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

export function isAllowedPropertyUrl(rawUrl: string, allowedHosts: Set<string>): boolean {
  const hostname = hostnameFromUrl(rawUrl);
  if (!hostname || isPrivateOrLocalHostname(hostname)) return false;
  if (hostname === "downtowncyprus.com" || hostname.endsWith(".downtowncyprus.com")) return true;
  for (const allowed of allowedHosts) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export function normalizeAllowedPropertyDomains(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,]+/);
  return uniqueStrings(candidates
    .map((item) => hostnameFromUrl(String(item || "")))
    .filter((item): item is string => Boolean(item) && !isPrivateOrLocalHostname(item))
    .filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(item)))
    .slice(0, MAX_ALLOWED_DOMAINS);
}
