import { businessProfileSchema, businessUrlSchema, type BusinessProfile } from './schema';

/**
 * One-time mapping from today's scattered storage to a Business profile (phase 2 copy). Pure. Copied values become
 * known facts that nobody has confirmed yet (confirmedAt null, no sources). Website demo fallbacks and values the
 * profile can't hold faithfully are skipped and reported, never guessed.
 */
export type LegacyBusinessData = {
    publicSite?: Record<string, any> | null; navigation?: Record<string, any> | null; ai?: Record<string, any> | null;
    siteConfig?: Record<string, any> | null;
};
export type CopyResult = { profile: BusinessProfile; copied: string[]; skipped: { field: string; value: string; reason: string }[] };

/**
 * Made-up placeholders the Estio public footer shows when nothing is saved; never business facts. The footer's demo
 * email is left out on purpose: it is Down Town Cyprus's real address, saved by its owner.
 */
export const demoDefaults = new Set(['123 makariou avenue, limassol 3030, cyprus', '+357 99 123 456', '+357 25 123 456']);
const phonePattern = /^\+?[0-9][0-9 ()\-.]{5,24}$/;
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const hex = (v: unknown) => { const s = str(v); if (!s) return null; const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s); if (!m) return null;
    return m[1].length === 3 ? `#${m[1].split('').map(c => c + c).join('')}`.toLowerCase() : s.toLowerCase(); };
const isUrl = (v: string) => businessUrlSchema.safeParse(v).success;

export function profileFromLegacy(data: LegacyBusinessData): CopyResult {
    const fact = <T>(value: T) => ({ status: 'known' as const, value, sources: [] as never[], confirmedAt: null });
    const copied: string[] = [], skipped: CopyResult['skipped'] = [];
    const skip = (field: string, value: unknown, reason: string) => skipped.push({ field, value: String(value).slice(0, 200), reason });
    const usable = (field: string, value: string | null) => {
        if (!value) return null;
        if (demoDefaults.has(value.toLowerCase())) { skip(field, value, 'website demo placeholder'); return null; }
        return value;
    };
    const site = data.publicSite ?? {}, nav = data.navigation ?? {}, ai = data.ai ?? {}, legacy = data.siteConfig ?? {};
    const contactInfo = (site.contactInfo && Object.keys(site.contactInfo).length ? site.contactInfo : legacy.contactInfo) ?? {};
    const theme = (site.theme && Object.keys(site.theme).length ? site.theme : legacy.theme) ?? {};
    const profile: Record<string, any> = { schemaVersion: 1 };
    const put = (section: string, key: string, value: unknown, label: string) => { profile[section] = { ...profile[section], [key]: value }; copied.push(label); };

    const address = usable('address', str(contactInfo.address));
    if (address) put('contact', 'address', fact({ formatted: fact(address) }), 'address');
    const phones: { number: unknown; label: unknown }[] = [];
    for (const [key, label] of [['mobile', 'Mobile'], ['landline', 'Landline'], ['phone', 'Phone']] as const) {
        const number = usable(`phone (${key})`, str(contactInfo[key]));
        if (!number || phones.some(p => (p.number as { value: string }).value === number)) continue;
        if (!phonePattern.test(number)) { skip(`phone (${key})`, number, 'not a phone number'); continue; }
        phones.push({ number: fact(number), label: fact(label) });
    }
    if (phones.length) put('contact', 'phones', fact(phones), `${phones.length} phone(s)`);
    const email = usable('email', str(contactInfo.email));
    if (email) { if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) put('contact', 'email', fact(email), 'email'); else skip('email', email, 'not an email address'); }
    const mapsLink = str(contactInfo.mapsLink);
    if (mapsLink && mapsLink !== '#') {
        if (isUrl(mapsLink)) put('contact', 'maps', fact([{ url: fact(mapsLink), ...(str(contactInfo.mapsLinkTitle) ? { title: fact(str(contactInfo.mapsLinkTitle)) } : {}) }]), 'map link');
        else skip('map link', mapsLink, 'not a full web address');
    }

    const socials: unknown[] = Array.isArray(nav.socialLinks) && nav.socialLinks.length ? nav.socialLinks : Array.isArray(site.socialLinks) && site.socialLinks.length ? site.socialLinks : Array.isArray(legacy.socialLinks) ? legacy.socialLinks : [];
    const profiles = socials.flatMap(s => { const link = s as { platform?: unknown; url?: unknown }; const platform = str(link.platform), url = str(link.url);
        if (!platform || !url) return []; if (!isUrl(url)) { skip(`social link (${platform})`, url, 'not a full web address'); return []; }
        return [{ platform: fact(platform), url: fact(url) }]; });
    if (profiles.length) put('onlinePresence', 'profiles', fact(profiles), `${profiles.length} social link(s)`);

    const logo = theme.logo ?? {};
    const logos = (['url', 'lightUrl', 'iconUrl', 'faviconUrl'] as const).flatMap((key, i) => { const url = str(logo[key]); if (!url) return [];
        if (!isUrl(url)) { skip(`logo (${key})`, url, 'not a full web address'); return []; }
        return [{ variant: fact((['primary', 'light', 'icon', 'favicon'] as const)[i]), url: fact(url) }]; });
    const colours = (['primary', 'secondary', 'accent'] as const).flatMap(role => { const raw = theme[`${role}Color`] ?? legacy[`${role}Color`]; const value = hex(raw);
        if (!value) { if (str(raw)) skip(`${role} colour`, raw, 'not a hex colour'); return []; } return [{ role: fact(role), hex: fact(value) }]; });
    if (logos.length) put('visualIdentity', 'logos', fact(logos), `${logos.length} logo(s)`);
    if (colours.length) put('visualIdentity', 'colours', fact(colours), `${colours.length} colour(s)`);

    const market = site.marketProfile ?? {};
    for (const key of ['countryCode', 'countryName', 'locale', 'currencyCode'] as const) {
        const value = str(market[key]); if (value) put('audienceMarket', key, fact(key.endsWith('Code') ? value.toUpperCase() : value), `market ${key}`);
    }
    const languages = (Array.isArray(market.supportedLanguages) ? market.supportedLanguages : []).map(str).filter(Boolean);
    if (languages.length) put('audienceMarket', 'supportedLanguages', fact(languages.map((l: string) => fact(l))), 'languages');
    const areas = (Array.isArray(market.serviceAreas) ? market.serviceAreas : []).flatMap((a: Record<string, unknown>) => { const id = str(a.id), label = str(a.label); if (!id || !label) return [];
        return [{ id: fact(id), label: fact(label), aliases: fact((Array.isArray(a.aliases) ? a.aliases : []).map(str).filter(Boolean).map(x => fact(x))),
            ...(str(a.parentId) ? { parentId: fact(str(a.parentId)) } : {}), ...(str(a.kind) ? { kind: fact(str(a.kind)) } : {}) }]; });
    if (areas.length) put('audienceMarket', 'serviceAreas', fact(areas), `${areas.length} service area(s)`);

    // The Studio brand profile is owner-curated, so its summary wins over the website footer text.
    const brand = ai.brandProfile ?? null;
    const footerBio = str(nav.footerBio) ?? str(site.footerBio) ?? str(legacy.footerBio);
    if (brand?.profile) {
        const p = brand.profile;
        if (str(p.summary)) put('identity', 'summary', fact(str(p.summary)), 'summary (brand profile)');
        if (footerBio && footerBio !== str(p.summary)) skip('footer bio', footerBio, 'brand profile summary used instead');
        if (str(p.offer)) put('offer', 'description', fact(str(p.offer)), 'offer');
        if (str(p.audience)) put('audienceMarket', 'audience', fact(str(p.audience)), 'audience');
        if (str(p.tone)) put('brandVoice', 'tone', fact(str(p.tone)), 'tone');
        for (const [from, to] of [['useWords', 'preferredWords'], ['avoidWords', 'avoidedWords'], ['pillars', 'contentPillars']] as const) {
            const list = (Array.isArray(p[from]) ? p[from] : []).map(str).filter((w): w is string => Boolean(w));
            if (list.length) put('brandVoice', to, fact(list.map((w: string) => fact(w))), to);
        }
        const answers = Object.fromEntries(Object.entries(brand.answers ?? {}).flatMap(([k, v]) => str(v) ? [[k, fact(str(v))]] : []));
        profile.brandProfileCapture = { answers, sources: (brand.sources ?? []).filter((s: { url?: string }) => s.url && isUrl(s.url)).map((s: { url: string; fetchedAt?: string; platform?: string }) =>
            ({ kind: 'url', url: s.url, retrievedAt: s.fetchedAt ?? null, ...(s.platform ? { platform: s.platform } : {}) })), scriptVersion: brand.scriptVersion ?? 'v1', updatedAt: brand.updatedAt, updatedBy: brand.updatedBy };
        copied.push('brand profile capture');
    } else {
        if (footerBio) put('identity', 'summary', fact(footerBio), 'summary (footer bio)');
        const voice = str(ai.brandVoice) ?? str(legacy.brandVoice);
        if (voice) put('brandVoice', 'instructions', fact(voice), 'brand voice instructions');
    }
    return { profile: businessProfileSchema.parse(profile), copied, skipped };
}
