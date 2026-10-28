import 'server-only';
import { canSaveBrandProfile } from './access-policy';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { getStudioAccess } from '@/lib/studio/access';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS } from '@/lib/settings/constants';
import { brandProfileSchema, brandProfileInputSchema, renderBrandVoice, type BrandProfileInput } from './schema';

export async function getBrandProfile(locationId: string) {
    if (!await getStudioAccess(locationId)) throw new Error('Location access denied');
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
    const profile = { ...parsed, updatedAt: new Date().toISOString(), updatedBy: actor.id };
    const brandVoice = renderBrandVoice(parsed.profile);
    await db.$transaction(async tx => {
        const document = await settingsService.getDocument<Record<string, unknown>>({ scopeType: 'LOCATION', scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, tx });
        await settingsService.upsertDocument({ scopeType: 'LOCATION', scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
            payload: { whatsappTranscriptRetentionDays: 90, whatsappTranscriptVisibility: 'team', ...document?.payload, brandProfile: profile, brandVoice }, expectedVersion: document?.version ?? 0, actorUserId: actor.id, tx });
        await tx.siteConfig.upsert({ where: { locationId }, create: { locationId, brandVoice }, update: { brandVoice } });
    });
    return profile;
}
