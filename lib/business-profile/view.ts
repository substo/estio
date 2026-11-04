import type { BusinessProfile } from './schema';

/**
 * The flat, plain view of a Location's business details that every reader uses (websites, CRM, Studio, AI prompts).
 * Client-safe and pure. Only facts with status "known" appear; anything unknown, not applicable or missing is null or
 * empty. Name, time zone and domain always come from the Location itself, never from the profile.
 */
export type BusinessView = {
    name: string | null; timeZone: string | null; domain: string | null;
    website: string | null; tagline: string | null; summary: string | null;
    address: string | null; phones: { label: string | null; number: string }[]; email: string | null;
    maps: { url: string; title: string | null }[]; socialLinks: { platform: string; url: string }[];
    logos: { primary: string | null; light: string | null; icon: string | null; favicon: string | null };
    colours: { primary: string | null; secondary: string | null; accent: string | null };
    offer: string | null; audience: string | null;
    voice: { instructions: string | null; tone: string | null; preferredWords: string[]; avoidedWords: string[]; contentPillars: string[] };
    brandVoice: string | null;
    market: { countryCode: string | null; countryName: string | null; locale: string | null; currencyCode: string | null; supportedLanguages: string[];
        serviceAreas: { id: string; label: string; aliases: string[]; parentId: string | null; kind: string | null }[] };
    realEstate: Record<string, string[]> | null;
};
type Fact = { status: string; value?: unknown } | undefined;
/** The value of a known fact, else null. */
export function known<T>(fact: Fact): T | null {
    return fact && fact.status === 'known' ? fact.value as T : null;
}
const text = (fact: Fact) => { const v = known<string>(fact); return typeof v === 'string' && v.trim() ? v.trim() : null; };
const texts = (fact: Fact) => (known<Fact[]>(fact) ?? []).map(text).filter((v): v is string => !!v);
const items = <T>(fact: Fact) => known<T[]>(fact) ?? [];

/** Brand voice as prompt text, matching lib/brand-profile renderBrandVoice when no written instructions exist. */
export function renderVoice(view: Pick<BusinessView, 'summary' | 'audience' | 'offer' | 'voice'>) {
    if (view.voice.instructions) return view.voice.instructions;
    const lines = [
        view.summary && `Summary: ${view.summary}`, view.audience && `Audience: ${view.audience}`, view.offer && `Offer: ${view.offer}`,
        view.voice.tone && `Tone: ${view.voice.tone}`, view.voice.preferredWords.length ? `Use: ${view.voice.preferredWords.join(', ')}` : null,
        view.voice.avoidedWords.length ? `Avoid: ${view.voice.avoidedWords.join(', ')}` : null,
        view.voice.contentPillars.length ? `Content pillars: ${view.voice.contentPillars.join('; ')}` : null,
    ].filter(Boolean);
    return lines.length ? lines.join('\n') : null;
}

export function businessView(profile: BusinessProfile | null | undefined, location: { name?: string | null; timeZone?: string | null; domain?: string | null }): BusinessView {
    const p = profile ?? { schemaVersion: 1 as const };
    const address = known<Record<string, Fact>>(p.contact?.address);
    const addressText = address ? text(address.formatted) ?? (['line1', 'line2', 'city', 'region', 'postalCode', 'countryCode'].map(k => text(address[k])).filter(Boolean).join(', ') || null) : null;
    const logos = { primary: null, light: null, icon: null, favicon: null } as BusinessView['logos'];
    for (const logo of items<Record<string, Fact>>(p.visualIdentity?.logos)) {
        const variant = text(logo.variant), url = text(logo.url);
        if (url && variant && variant in logos && !logos[variant as keyof typeof logos]) logos[variant as keyof typeof logos] = url;
    }
    const colours = { primary: null, secondary: null, accent: null } as BusinessView['colours'];
    for (const colour of items<Record<string, Fact>>(p.visualIdentity?.colours)) {
        const role = text(colour.role), hex = text(colour.hex);
        if (hex && role && role in colours && !colours[role as keyof typeof colours]) colours[role as keyof typeof colours] = hex;
    }
    const voice = { instructions: text(p.brandVoice?.instructions), tone: text(p.brandVoice?.tone), preferredWords: texts(p.brandVoice?.preferredWords),
        avoidedWords: texts(p.brandVoice?.avoidedWords), contentPillars: texts(p.brandVoice?.contentPillars) };
    const market = p.audienceMarket;
    const realEstate = known<Record<string, Fact>>(p.realEstate);
    const view: BusinessView = {
        name: location.name?.trim() || null, timeZone: location.timeZone?.trim() || null, domain: location.domain?.trim() || null,
        website: text(p.onlinePresence?.website), tagline: text(p.identity?.tagline), summary: text(p.identity?.summary),
        address: addressText,
        phones: items<Record<string, Fact>>(p.contact?.phones).flatMap(ph => { const number = text(ph.number); return number ? [{ label: text(ph.label), number }] : []; }),
        email: text(p.contact?.email),
        maps: items<Record<string, Fact>>(p.contact?.maps).flatMap(m => { const url = text(m.url); return url ? [{ url, title: text(m.title) }] : []; }),
        socialLinks: items<Record<string, Fact>>(p.onlinePresence?.profiles).flatMap(s => { const platform = text(s.platform), url = text(s.url); return platform && url ? [{ platform, url }] : []; }),
        logos, colours, offer: text(p.offer?.description), audience: text(market?.audience), voice, brandVoice: null,
        market: { countryCode: text(market?.countryCode), countryName: text(market?.countryName), locale: text(market?.locale), currencyCode: text(market?.currencyCode),
            supportedLanguages: texts(market?.supportedLanguages),
            serviceAreas: items<Record<string, Fact>>(market?.serviceAreas).flatMap(a => { const id = text(a.id), label = text(a.label);
                return id && label ? [{ id, label, aliases: texts(a.aliases), parentId: text(a.parentId), kind: text(a.kind) }] : []; }) },
        realEstate: realEstate ? Object.fromEntries(Object.entries(realEstate).map(([key, fact]) => [key, items<Record<string, Fact> | Fact>(fact as Fact)
            .map(entry => entry && typeof entry === 'object' && 'code' in entry ? text((entry as Record<string, Fact>).code) : text(entry as Fact)).filter((v): v is string => !!v)])) : null,
    };
    view.brandVoice = renderVoice(view);
    return view;
}

/** Editable flat fields. undefined = unchanged; null (or empty) = remove the fact. */
export type BusinessDetailsPatch = Partial<{
    website: string | null; tagline: string | null; summary: string | null; address: string | null;
    phones: { label: string | null; number: string }[] | null; email: string | null;
    maps: { url: string; title: string | null }[] | null; socialLinks: { platform: string; url: string }[] | null;
    logos: Partial<BusinessView['logos']>; colours: Partial<BusinessView['colours']>;
    offer: string | null; audience: string | null;
    voice: Partial<BusinessView['voice']>;
    market: Partial<Omit<BusinessView['market'], 'serviceAreas'>> & { serviceAreas?: BusinessView['market']['serviceAreas'] | null };
}>;
