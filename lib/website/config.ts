import { sitePath, websiteSettings, safeImageUrl, siteLink } from "@/lib/substo-sites/policy";

/** Public design fields only. Provider keys and Location credentials never cross this boundary. */
export const websiteDesignSelect = {
    theme: true, contactInfo: true, navLinks: true, footerLinks: true, socialLinks: true,
    legalLinks: true, footerBio: true, footerDisclaimer: true,
} as const;

export function hostedWebsiteConfig(row: any, slug: string, fallbackName = "Our brand") {
    const legacy = websiteSettings(row?.substoSiteConfig, fallbackName);
    const theme = row?.theme && typeof row.theme === "object" ? row.theme : {};
    const logo = theme.logo || {};
    const text = (value: unknown, fallback = "") => typeof value === "string" ? value.slice(0, 2000) : fallback;
    const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    const links = (value: unknown): any[] => Array.isArray(value) ? value.slice(0, 100).flatMap((link) => {
        const href = siteLink(link?.href, slug);
        return href ? [{ label: text(link.label), href, type: link.type === "category" ? "category" : "custom", children: links(link.children) }] : [];
    }) : [];
    const navLinks = links(row?.navLinks);
    return {
        locationId: row?.locationId, name: text(logo.textTop, legacy.title), location: { name: text(logo.textTop, legacy.title) }, domain: sitePath(slug),
        theme: {
            primaryColor: color(theme.primaryColor, legacy.accent), secondaryColor: color(theme.secondaryColor, "#ffffff"),
            accentColor: color(theme.accentColor, "#f5f5f5"), backgroundColor: color(theme.backgroundColor, "#ffffff"), textColor: color(theme.textColor, "#000000"),
            headerStyle: theme.headerStyle === "transparent" ? "transparent" : "solid", menuStyle: theme.menuStyle === "top" ? "top" : "side",
            logo: { url: safeImageUrl(logo.url) || legacy.logoUrl, lightUrl: safeImageUrl(logo.lightUrl) || "", iconUrl: safeImageUrl(logo.iconUrl) || "", faviconUrl: safeImageUrl(logo.faviconUrl) || "", textTop: text(logo.textTop, legacy.title), textBottom: text(logo.textBottom) },
        },
        contactInfo: { address: text(row?.contactInfo?.address), mapsLink: siteLink(row?.contactInfo?.mapsLink, slug) || "", mapsLinkTitle: text(row?.contactInfo?.mapsLinkTitle), mobile: text(row?.contactInfo?.mobile), landline: text(row?.contactInfo?.landline), email: text(row?.contactInfo?.email, legacy.email) },
        navLinks: navLinks.length ? navLinks : [{ label: "Home", href: sitePath(slug) }, { label: "Blog", href: `${sitePath(slug)}/blog` }],
        footerLinks: links(row?.footerLinks), legalLinks: links(row?.legalLinks),
        socialLinks: Array.isArray(row?.socialLinks) ? row.socialLinks.slice(0, 30).flatMap((link: any) => {
            const url = safeImageUrl(link?.url); return url ? [{ platform: text(link.platform), url }] : [];
        }) : [],
        footerBio: text(row?.footerBio, legacy.description), footerDisclaimer: text(row?.footerDisclaimer), publicListingEnabled: false,
    };
}
