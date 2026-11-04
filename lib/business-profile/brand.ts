import { brandProfileSchema } from '@/lib/brand-profile/schema';
import type { BusinessProfile } from './schema';
import { businessView } from './view';

/**
 * The Studio brand profile as a view of the Business profile (summary, audience, offer, brand voice and the
 * onboarding capture). Null until a summary exists, so Studio keeps inviting the owner to set up the brand. Pure.
 */
export function brandProfileFromBusiness(profile: BusinessProfile) {
    const view = businessView(profile, {});
    if (!view.summary) return null;
    const capture = profile.brandProfileCapture;
    const answers = Object.fromEntries(Object.entries(capture?.answers ?? {}).flatMap(([k, fact]) => fact.status === 'known' ? [[k, String(fact.value)]] : []));
    const at = capture?.updatedAt ?? new Date(0).toISOString();
    const sources = (capture?.sources ?? []).flatMap(source => source.kind === 'url' ? [{ url: source.url, fetchedAt: source.retrievedAt ?? at, ...(source.platform ? { platform: source.platform } : {}) }] : []);
    return brandProfileSchema.parse({ answers, sources, scriptVersion: 'v1', updatedAt: at, updatedBy: capture?.updatedBy ?? 'business-profile',
        profile: { summary: view.summary, audience: view.audience ?? '', offer: view.offer ?? '', tone: view.voice.tone ?? '',
            useWords: view.voice.preferredWords, avoidWords: view.voice.avoidedWords, pillars: view.voice.contentPillars } });
}
