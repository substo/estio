import 'server-only';
import db from '@/lib/db';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS } from '@/lib/settings/constants';
import { businessProfileSchema, type BusinessProfile } from './schema';
import { applyDetailsPatch } from './patch';
import { businessView, type BusinessDetailsPatch } from './view';

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

/** Saves owner-entered values as confirmed facts; unchanged values keep their facts. Fails if someone saved in between. */
export async function saveBusinessDetails(locationId: string, patch: BusinessDetailsPatch, actorUserId: string, options: { expectedVersion?: number } = {}) {
    const { profile, version } = await getBusinessProfile(locationId);
    const next = applyDetailsPatch(profile, patch, actorUserId);
    await settingsService.upsertDocument({ ...scope(locationId), payload: next, actorUserId, expectedVersion: options.expectedVersion ?? version });
    return next;
}
