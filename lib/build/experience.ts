/**
 * Experience map: the product as users see it (section › area › screen), derived from Next.js page routes with no
 * model call. Files stay attached underneath as evidence. Owner renames win over derivation (naming = "owner").
 */
export type Experience = { route: string; section: string; area: string; name: string; product: "crm" | "studio" | "shared" };

const words: Record<string, string> = { ai: "AI", crm: "CRM", seo: "SEO", sms: "SMS", api: "API", ghl: "GHL", sso: "SSO", url: "URL", ui: "UI", faq: "FAQ", whatsapp: "WhatsApp", oauth: "OAuth" };
const label = (segment: string) => {
  if (/^\[\.\.\./.test(segment)) return "All";
  if (/^\[/.test(segment)) return "Detail";
  return segment.split(/[-_]/).filter(Boolean).map(w => words[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1)).join(" ");
};
/** URL route for an app/ page file, or null for anything that is not a screen. */
export function pageRoute(file: string) {
  const m = /^app\/(?:(.*)\/)?page\.tsx$/.exec(file);
  if (!m) return null;
  // Route groups, parallel slots and optional catch-alls do not change what the user sees.
  const parts = (m[1] ?? "").split("/").filter(p => p && !/^\(.*\)$/.test(p) && !p.startsWith("@") && !p.startsWith("[[..."));
  return "/" + parts.join("/");
}
export function experienceFor(file: string): Experience | null {
  const route = pageRoute(file);
  if (route === null) return null;
  const parts = route.split("/").filter(Boolean);
  const named = (rest: string[], fallback: string) => rest.length ? rest.map(label).join(" › ") : fallback;
  let section: string, product: Experience["product"], rest: string[];
  if (parts[0] === "admin" && parts[1] === "platform") { section = "Platform admin"; product = "shared"; rest = parts.slice(2); }
  else if (parts[0] === "admin") { section = "CRM"; product = "crm"; rest = parts.slice(1); }
  else if (parts[0] === "studio") { section = "Studio"; product = "studio"; rest = parts.slice(1); }
  else if (["[domain]", "sites", "widget"].includes(parts[0] ?? "")) { section = "Public website"; product = "crm"; rest = parts[0] === "widget" ? parts : parts.slice(parts[0] === "sites" ? 2 : 1); }
  else { section = "Account & onboarding"; product = "shared"; rest = parts; }
  const area = rest.length ? (rest[0].startsWith("[") ? "Pages" : label(rest[0])) : section === "Platform admin" ? "Overview" : "Home";
  return { route, section, area, product, name: named(rest, section === "Public website" ? "Home page" : "Overview") };
}
