import 'server-only';
import { canSaveBrandProfile } from './access-policy';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { getStudioAccess } from '@/lib/studio/access';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS } from '@/lib/settings/constants';
import { brandProfileSchema, brandProfileInputSchema, type BrandProfileInput } from './schema';
import { getBusinessProfile, getBusinessViewIfAny, saveBusinessDetails } from '@/lib/business-profile/service';
import { brandProfileFromBusiness } from '@/lib/business-profile/brand';

/**
 * The Studio brand profile, as a view of the Business profile (summary, audience, offer, brand voice and the onboarding
 * capture). A Location without a Business profile keeps reading its old copy until its first save.
 */
export async function getBrandProfile(locationId: string) {
    if (!await getStudioAccess(locationId)) throw new Error('Location access denied');
    const { profile } = await getBusinessProfile(locationId);
    if (profile) return brandProfileFromBusiness(profile);
    const document = await settingsService.getDocument<Record<string, unknown>>({ scopeType: 'LOCATION', scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
    return document?.payload?.brandProfile ? brandProfileSchema.parse(document.payload.brandProfile) : null;
}
/** Session identity and active Location are checked server-side, never supplied by the browser. */
export async function saveBrandProfile(locationId: string, input: BrandProfileInput) {
    const [access, session] = await Promise.all([getStudioAccess(locationId), auth()]);
    if (!canSaveBrandProfile({ locationId, activeLocationId: access?.locationId ?? null, role: access?.role ?? null, sessionUserId: session.userId, accessUserId: access?.userId ?? null, impersonating: Boolean(session.actor) }) || !access) throw new Error('Only an admin signed in as themselves can save the profile');
    const parsed = brandProfileInputSchema.parse(input);
    if (!parsed.profile.summary.trim()) throw new Error("Add a profile summary before saving.");
    const actor = await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } });
    if (!actor) throw new Error('Account unavailable');
    const now = new Date().toISOString(), p = parsed.profile;
    // Sources tagged with a platform are the business's own accounts, added to its social links.
    const current = await getBusinessViewIfAny(locationId);
    const socials = parsed.sources.filter(source => source.platform).map(source => ({ platform: source.platform!, url: source.url }));
    const socialLinks = socials.length ? [...(current?.socialLinks ?? []).filter(link => !socials.some(s => s.url === link.url)), ...socials] : undefined;
    const ownerFact = (value: string) => ({ status: 'known' as const, value, sources: [{ kind: 'owner' as const, ownerId: actor.id, suppliedAt: now }], confirmedAt: now });
    // The structured profile now defines the voice, so written instructions are cleared (as the old rendered text was replaced).
    await saveBusinessDetails(locationId, { summary: p.summary, audience: p.audience || null, offer: p.offer || null, ...(socialLinks ? { socialLinks } : {}),
        voice: { instructions: null, tone: p.tone || null, preferredWords: p.useWords, avoidedWords: p.avoidWords, contentPillars: p.pillars } }, actor.id, {
        capture: { answers: Object.fromEntries(Object.entries(parsed.answers).filter(([, v]) => v.trim()).map(([k, v]) => [k, ownerFact(v.trim())])),
            sources: parsed.sources.map(source => ({ kind: 'url' as const, url: source.url, retrievedAt: source.fetchedAt, ...(source.platform ? { platform: source.platform } : {}) })),
            scriptVersion: parsed.scriptVersion, updatedAt: now, updatedBy: actor.id } });
    return { ...parsed, updatedAt: now, updatedBy: actor.id };
}
