import { businessProfileSchema, type BusinessProfile } from './schema';
import { businessView, type BusinessDetailsPatch, type BusinessView } from './view';

/**
 * Applies owner-entered flat values to a profile. A changed value becomes a known fact supplied and confirmed by the
 * owner now; an unchanged value keeps its existing fact and provenance; null, "" or [] removes the fact. Pure.
 */
export function applyDetailsPatch(current: BusinessProfile | null | undefined, patch: BusinessDetailsPatch, ownerId: string, now = new Date()): BusinessProfile {
    const at = now.toISOString();
    const fact = <T>(value: T) => ({ status: 'known' as const, value, sources: [{ kind: 'owner' as const, ownerId, suppliedAt: at }], confirmedAt: at });
    const textFact = (value: string) => fact(value.trim());
    const profile = structuredClone(current ?? { schemaVersion: 1 }) as Record<string, Record<string, unknown> | number | undefined>;
    const view = businessView(current, {});
    const set = (section: string, key: string, value: unknown) => {
        const target = { ...((profile[section] as Record<string, unknown>) ?? {}) };
        if (value === undefined) delete target[key]; else target[key] = value;
        if (Object.keys(target).length) profile[section] = target; else delete profile[section];
    };
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    /** Applies one flat field: unchanged keeps the fact, empty removes it, otherwise build a new owner fact. */
    const field = <K extends keyof BusinessView>(key: K, next: BusinessView[K] | null | undefined, section: string, path: string, build: (v: NonNullable<BusinessView[K]>) => unknown) => {
        if (next === undefined || same(normalize(next), normalize(view[key]))) return;
        set(section, path, empty(next) ? undefined : build(next as NonNullable<BusinessView[K]>));
    };
    field('website', patch.website, 'onlinePresence', 'website', v => textFact(v as string));
    field('tagline', patch.tagline, 'identity', 'tagline', v => textFact(v as string));
    field('summary', patch.summary, 'identity', 'summary', v => textFact(v as string));
    field('address', patch.address, 'contact', 'address', v => fact({ formatted: textFact(v as string) }));
    field('phones', patch.phones, 'contact', 'phones', v => fact((v as BusinessView['phones']).map(p => ({ number: textFact(p.number), ...(p.label?.trim() ? { label: textFact(p.label) } : {}) }))));
    field('email', patch.email, 'contact', 'email', v => textFact(v as string));
    field('maps', patch.maps, 'contact', 'maps', v => fact((v as BusinessView['maps']).map(m => ({ url: textFact(m.url), ...(m.title?.trim() ? { title: textFact(m.title) } : {}) }))));
    field('socialLinks', patch.socialLinks, 'onlinePresence', 'profiles', v => fact((v as BusinessView['socialLinks']).map(s => ({ platform: textFact(s.platform), url: textFact(s.url) }))));
    field('offer', patch.offer, 'offer', 'description', v => textFact(v as string));
    field('audience', patch.audience, 'audienceMarket', 'audience', v => textFact(v as string));
    if (patch.logos) {
        const merged = { ...view.logos, ...patch.logos };
        if (!same(merged, view.logos)) {
            const list = (Object.entries(merged) as [string, string | null][]).filter(([, url]) => url?.trim()).map(([variant, url]) => ({ variant: fact(variant), url: textFact(url!) }));
            set('visualIdentity', 'logos', list.length ? fact(list) : undefined);
        }
    }
    if (patch.colours) {
        const merged = { ...view.colours, ...patch.colours };
        if (!same(merged, view.colours)) {
            const list = (Object.entries(merged) as [string, string | null][]).filter(([, hex]) => hex?.trim()).map(([role, hex]) => ({ role: fact(role), hex: textFact(hex!) }));
            set('visualIdentity', 'colours', list.length ? fact(list) : undefined);
        }
    }
    const words = (list: string[]) => fact(list.map(w => textFact(w)).filter(w => w.value));
    for (const key of ['instructions', 'tone'] as const) {
        const next = patch.voice?.[key];
        if (next !== undefined && next?.trim() !== (view.voice[key] ?? undefined)) set('brandVoice', key, next?.trim() ? textFact(next) : undefined);
    }
    for (const key of ['preferredWords', 'avoidedWords', 'contentPillars'] as const) {
        const next = patch.voice?.[key];
        if (next !== undefined && !same(next, view.voice[key])) set('brandVoice', key, next.length ? words(next) : undefined);
    }
    for (const key of ['countryCode', 'countryName', 'locale', 'currencyCode'] as const) {
        const next = patch.market?.[key];
        if (next !== undefined && (next?.trim() || null) !== view.market[key]) set('audienceMarket', key, next?.trim() ? textFact(key.endsWith('Code') ? next.toUpperCase() : next) : undefined);
    }
    if (patch.market?.supportedLanguages !== undefined && !same(patch.market.supportedLanguages, view.market.supportedLanguages))
        set('audienceMarket', 'supportedLanguages', patch.market.supportedLanguages.length ? words(patch.market.supportedLanguages) : undefined);
    if (patch.market?.serviceAreas !== undefined && !same(patch.market.serviceAreas, view.market.serviceAreas)) {
        const areas = patch.market.serviceAreas ?? [];
        set('audienceMarket', 'serviceAreas', areas.length ? fact(areas.map(a => ({ id: textFact(a.id), label: textFact(a.label), aliases: words(a.aliases),
            ...(a.parentId ? { parentId: textFact(a.parentId) } : {}), ...(a.kind ? { kind: fact(a.kind) } : {}) }))) : undefined);
    }
    return businessProfileSchema.parse(profile);
}
function normalize(v: unknown): unknown {
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) return v.length ? v : null;
    return v ?? null;
}
