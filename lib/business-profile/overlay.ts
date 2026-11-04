import type { BusinessView } from './view';

/**
 * Puts a Location's business details onto a website config row (the SiteConfig shape the public site, hosted Substo
 * sites, widgets, print and editors already read), so display code keeps working while the Business profile is the
 * only source. Business fields are replaced entirely: unknown values become empty and the existing presentation
 * defaults apply, so stale copies never show. Layout (logo text lines, background/text colours, header/menu style,
 * links, disclaimer, hero, sections) is left exactly as stored. Pure; with no profile the row is returned unchanged.
 */
export function overlayBusinessDetails<T extends Record<string, any> | null | undefined>(row: T, view: BusinessView | null): T {
    if (!row || !view) return row;
    const phones = view.phones;
    const byLabel = (label: string) => phones.find(p => p.label?.toLowerCase() === label)?.number ?? null;
    const mobile = byLabel('mobile') ?? phones.find(p => !/landline/i.test(p.label ?? ''))?.number ?? null;
    const landline = byLabel('landline') ?? phones.find(p => p.number !== mobile)?.number ?? null;
    const map = view.maps[0];
    const theme = row.theme && typeof row.theme === 'object' ? row.theme : {};
    const logo = theme.logo && typeof theme.logo === 'object' ? theme.logo : {};
    const legacySite = row.substoSiteConfig && typeof row.substoSiteConfig === 'object' ? row.substoSiteConfig : null;
    return {
        ...row,
        contactInfo: { address: view.address ?? '', mobile: mobile ?? '', landline: landline ?? '', email: view.email ?? '', mapsLink: map?.url ?? '', mapsLinkTitle: map?.title ?? '' },
        socialLinks: view.socialLinks.map(s => ({ platform: s.platform, url: s.url })),
        footerBio: view.summary ?? '',
        // brandVoice is kept server-side only; callers that send rows to the browser strip it as before.
        ...('brandVoice' in row ? { brandVoice: view.brandVoice } : {}),
        primaryColor: view.colours.primary, secondaryColor: view.colours.secondary, accentColor: view.colours.accent,
        theme: { ...theme, primaryColor: view.colours.primary, secondaryColor: view.colours.secondary, accentColor: view.colours.accent,
            logo: { ...logo, url: view.logos.primary ?? '', lightUrl: view.logos.light ?? '', iconUrl: view.logos.icon ?? '', faviconUrl: view.logos.favicon ?? '' } },
        // The legacy Substo website copy only fills gaps; with a profile, its business fields must not resurface.
        ...(legacySite ? { substoSiteConfig: { ...legacySite, description: view.summary ?? '', email: view.email ?? '', accent: view.colours.primary ?? undefined, logoUrl: view.logos.primary ?? '' } } : {}),
    };
}
