import 'server-only';
import db from '@/lib/db';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS } from '@/lib/settings/constants';
import { businessProfileSchema, type BusinessProfile } from './schema';
import { applyDetailsPatch } from './patch';
import { businessView, type BusinessDetailsPatch, type BusinessView } from './view';
import { overlayBusinessDetails } from './overlay';
import { profileFromLegacy } from './copy';
import { getWebsiteSettings } from '@/lib/website/settings-service';
import { overlayWebsiteLayout } from '@/lib/website/settings';

/**
 * The Business profile of a Location: the single home for its business details (settings document location.business).
 * Callers authorise first; this module only reads and writes. Name, time zone and domain stay on Location.
 */
const scope = (locationId: string) => ({ scopeType: 'LOCATION' as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_BUSINESS });

export async function getBusinessProfile(locationId: string): Promise<{ profile: BusinessProfile | null; version: number }> {
    const document = await settingsService.getDocument<BusinessProfile>(scope(locationId));
    return { profile: document ? businessProfileSchema.parse(document.payload) : null, version: document?.version ?? 0 };
}

/** The flat view readers use, with name, time zone and domain from the Location row. */
export async function getBusinessDetails(locationId: string) {
    const [{ profile }, location] = await Promise.all([getBusinessProfile(locationId), db.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true, domain: true } })]);
    return businessView(profile, location ?? {});
}

/** The flat view only when the Location has a profile; null means "no profile yet", so callers keep today's data. */
export async function getBusinessViewIfAny(locationId: string): Promise<BusinessView | null> {
    const { profile } = await getBusinessProfile(locationId);
    if (!profile) return null;
    const location = await db.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true, domain: true } });
    return businessView(profile, location ?? {});
}
/**
 * A website config row (SiteConfig shape) as renderers need it: layout from the website document, then business fields
 * from the profile (overlay.ts). Rows of Locations without either keep their stored values.
 */
export async function withBusinessDetails<T extends Record<string, any> | null | undefined>(row: T, locationId: string | null | undefined): Promise<T> {
    if (!row || !locationId) return row;
    const [website, view] = await Promise.all([getWebsiteSettings(locationId), getBusinessViewIfAny(locationId)]);
    return overlayBusinessDetails(overlayWebsiteLayout(row, website?.payload), view);
}

/**
 * A Location without a profile gets one built from its existing data first (same mapping as the one-time copy), so a
 * first save never drops details that only lived in the old copies.
 */
async function seedProfile(locationId: string): Promise<BusinessProfile> {
    // SiteConfig is retired (phase 6); older business copies can only be in the settings documents.
    const docs = await db.settingsDocument.findMany({ where: { scopeType: 'LOCATION', scopeId: locationId, domain: { in: [SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE, SETTINGS_DOMAINS.LOCATION_AI] } } });
    const siteConfig = null;
    const payload = (domain: string) => docs.find(d => d.domain === domain)?.payload as Record<string, any> | undefined;
    return profileFromLegacy({ publicSite: payload(SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE), navigation: null,
        ai: payload(SETTINGS_DOMAINS.LOCATION_AI), siteConfig: siteConfig as Record<string, any> | null }).profile;
}

/** Saves owner-entered values as confirmed facts; unchanged values keep their facts. Fails if someone saved in between. */
export async function saveBusinessDetails(locationId: string, patch: BusinessDetailsPatch, actorUserId: string,
    options: { expectedVersion?: number; capture?: BusinessProfile['brandProfileCapture'] | null } = {}) {
    const { profile, version } = await getBusinessProfile(locationId);
    const next = applyDetailsPatch(profile ?? await seedProfile(locationId), patch, actorUserId);
    if (options.capture !== undefined) { if (options.capture) next.brandProfileCapture = options.capture; else delete next.brandProfileCapture; }
    const payload = businessProfileSchema.parse(next);
    await settingsService.upsertDocument({ ...scope(locationId), payload, actorUserId, expectedVersion: options.expectedVersion ?? version });
    return payload;
}
