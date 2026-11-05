/**
 * Website settings: one settings document per Location (location.public_site) holding website layout only. Business
 * details (contact, social links, logos, brand colours, summary, market, brand voice) live in the Business profile;
 * name, time zone and domain on Location. Pure helpers here; server reads/writes are in website-settings-service.ts.
 */
export const WEBSITE_LAYOUT_KEYS = [
    "theme", "navLinks", "footerLinks", "legalLinks", "footerDisclaimer", "menuStyle", "publicListingEnabled",
    "heroContent", "homeSections", "favoritesConfig", "searchConfig", "submissionsConfig",
] as const;
/** Business copies that older saves left in the website document; removed by the phase 5 merge. */
export const WEBSITE_BUSINESS_KEYS = ["domain", "locationName", "locationTimeZone", "contactInfo", "socialLinks", "footerBio", "marketProfile"] as const;
/** Theme keys that are business facts (brand colours), plus logo image URLs; the rest of the theme is layout. */
export const THEME_BUSINESS_KEYS = ["primaryColor", "secondaryColor", "accentColor"] as const;
export const LOGO_BUSINESS_KEYS = ["url", "lightUrl", "iconUrl", "faviconUrl"] as const;

type Row = Record<string, any>;
const isObject = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** Removes business copies from a website payload, keeping only layout. */
export function websiteLayoutOnly(payload: Row): Row {
    const out: Row = { ...payload };
    for (const key of WEBSITE_BUSINESS_KEYS) delete out[key];
    if (isObject(out.theme)) {
        const theme: Row = { ...out.theme };
        for (const key of THEME_BUSINESS_KEYS) delete theme[key];
        if (isObject(theme.logo)) { const logo: Row = { ...theme.logo }; for (const key of LOGO_BUSINESS_KEYS) delete logo[key]; theme.logo = logo; }
        out.theme = theme;
    }
    return out;
}

/**
 * Puts a Location's website layout onto a website config row (the SiteConfig shape renderers read). Only layout keys
 * present in the document replace the row's values; theme keys are merged so brand colours and logo URLs (applied
 * from the Business profile afterwards) are untouched. With no document the row is returned unchanged.
 */
export function overlayWebsiteLayout<T extends Row | null | undefined>(row: T, payload: Row | null | undefined): T {
    if (!row || !payload) return row;
    const out: Row = { ...row };
    for (const key of WEBSITE_LAYOUT_KEYS) {
        if (!(key in payload) || payload[key] === undefined) continue;
        if (key === "theme" && isObject(payload.theme)) {
            const current = isObject(row.theme) ? row.theme : {};
            const layout = websiteLayoutOnly({ theme: payload.theme }).theme as Row;
            out.theme = { ...current, ...layout, logo: { ...(isObject(current.logo) ? current.logo : {}), ...(isObject(layout.logo) ? layout.logo : {}) } };
        } else out[key] = payload[key];
    }
    return out as T;
}

/**
 * The single website document after folding the old navigation and content documents into it. On a key both hold, the
 * public_site value wins when that document is as new or newer; otherwise the newer document wins. Differing values are
 * reported either way so nothing changes silently.
 */
export function mergeWebsiteDocuments(input: { publicSite?: Row | null; publicSiteAt?: Date | null; navigation?: Row | null; navigationAt?: Date | null; content?: Row | null; contentAt?: Date | null }) {
    const merged: Row = { ...(input.publicSite ?? {}) };
    const conflicts: string[] = [];
    const siteAt = input.publicSiteAt?.getTime() ?? 0;
    for (const [name, source, at] of [["navigation", input.navigation, input.navigationAt], ["content", input.content, input.contentAt]] as const) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
            if (!(WEBSITE_LAYOUT_KEYS as readonly string[]).includes(key)) continue;
            if (!(key in merged) || merged[key] === undefined || merged[key] === null) { merged[key] = value; continue; }
            if (JSON.stringify(merged[key]) === JSON.stringify(value)) continue;
            const newer = (at?.getTime() ?? 0) > siteAt;
            conflicts.push(`${name}.${key} (kept ${newer ? name : "public_site"}, the newer document)`);
            if (newer) merged[key] = value;
        }
        // menuStyle used to live in navigation; the theme carries it for renderers.
        if (name === "navigation" && source.menuStyle && isObject(merged.theme) && !merged.theme.menuStyle) merged.theme = { ...merged.theme, menuStyle: source.menuStyle };
    }
    return { payload: websiteLayoutOnly(merged), conflicts };
}
