/**
 * Read-only proof for phase 3: what the public site, hosted website config, print branding, AI brand voice and market
 * context showed for a Location before (old copies) and now (Business profile), and every difference.
 * Usage: npx tsx scripts/business-profile/equivalence.ts [locationId ...]
 */
import { PrismaClient } from "@prisma/client";
import { businessProfileSchema } from "../../lib/business-profile/schema";
import { businessView } from "../../lib/business-profile/view";
import { overlayBusinessDetails } from "../../lib/business-profile/overlay";
import { hostedWebsiteConfig } from "../../lib/website/config";

const db = new PrismaClient();
const norm = (v: unknown): unknown => typeof v === "string" ? (v.trim() || null) : v === undefined ? null
    : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)])) : v;
const pick = (row: any) => row && {
    contactInfo: ["address", "mobile", "landline", "email", "mapsLink", "mapsLinkTitle"].map(k => [k, row.contactInfo?.[k]]),
    socialLinks: row.socialLinks, footerBio: row.footerBio,
    colours: [row.theme?.primaryColor, row.theme?.secondaryColor, row.theme?.accentColor],
    logos: ["url", "lightUrl", "iconUrl", "faviconUrl", "textTop", "textBottom"].map(k => [k, row.theme?.logo?.[k]]),
};
function diff(label: string, before: unknown, after: unknown) {
    const a = JSON.stringify(norm(before)), b = JSON.stringify(norm(after));
    console.log(a === b ? `  same      ${label}` : `  DIFFERENT ${label}\n    before: ${a}\n    after:  ${b}`);
}

async function check(locationId: string) {
    const [location, row, docs] = await Promise.all([
        db.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true, domain: true } }),
        db.siteConfig.findUnique({ where: { locationId } }),
        db.settingsDocument.findMany({ where: { scopeType: "LOCATION", scopeId: locationId } }),
    ]);
    const doc = (d: string) => docs.find(x => x.domain === d)?.payload as any;
    const business = doc("location.business");
    const view = business ? businessView(businessProfileSchema.parse(business), location ?? {}) : null;
    console.log(`\n${location?.name} (${locationId}) — profile: ${view ? "yes" : "no"}`);
    // Public site and widgets: SiteConfig row (getSiteConfig) before, overlaid now.
    const site = overlayBusinessDetails(row as any, view);
    diff("public site: contact", pick(row)?.contactInfo, pick(site)?.contactInfo);
    diff("public site: social links (non-empty)", ((row as any)?.socialLinks ?? []).filter((s: any) => s?.url), (site as any)?.socialLinks ?? []);
    diff("public site: social links (as rendered, incl. empty rows)", (row as any)?.socialLinks ?? [], (site as any)?.socialLinks ?? []);
    diff("public site: footer description", (row as any)?.footerBio, (site as any)?.footerBio);
    diff("public site: brand colours", pick(row)?.colours, pick(site)?.colours);
    diff("public site: logos and logo text", pick(row)?.logos, pick(site)?.logos);
    // Hosted (Substo) config uses the same row shape.
    if (row) diff("hosted website config", hostedWebsiteConfig(row, "preview", location?.name || "Our brand"), hostedWebsiteConfig(site, "preview", location?.name || "Our brand"));
    // Print branding read the public_site document first, then SiteConfig.
    const ps = doc("location.public_site") ?? {};
    const printBefore = { theme: ps.theme || (row as any)?.theme || {}, contactInfo: ps.contactInfo || (row as any)?.contactInfo || {} };
    const printAfter = overlayBusinessDetails({ ...printBefore } as any, view);
    diff("print: contact", pick(printBefore)?.contactInfo, pick(printAfter)?.contactInfo);
    diff("print: logo and primary colour", [printBefore.theme?.logo?.url, printBefore.theme?.primaryColor], [printAfter.theme?.logo?.url, printAfter.theme?.primaryColor]);
    // AI brand voice: coordinator read SiteConfig; print AI read the AI document then SiteConfig.
    diff("AI brand voice (coordinator)", (row as any)?.brandVoice, view ? view.brandVoice : (row as any)?.brandVoice);
    diff("AI brand voice (print AI)", doc("location.ai")?.brandVoice || (row as any)?.brandVoice, view ? view.brandVoice : doc("location.ai")?.brandVoice || (row as any)?.brandVoice);
    const market = view && (view.market.countryCode || view.market.currencyCode || view.market.serviceAreas.length || view.market.supportedLanguages.length) ? view.market : ps.marketProfile;
    diff("market profile input", ps.marketProfile, market);
}

(async () => {
    const ids = process.argv.slice(2);
    for (const id of ids.length ? ids : ["cmingx6b10008rdycg7hwesyn", "cmshgqe2j0000a4jjw6152pjf"]) await check(id);
})().finally(() => db.$disconnect());
