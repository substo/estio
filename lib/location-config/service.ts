import "server-only";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { getBusinessViewIfAny } from "@/lib/business-profile/service";
import { overlayBusinessDetails } from "@/lib/business-profile/overlay";
import { getWebsiteSettings, saveWebsiteLayout } from "@/lib/website/settings-service";
import { overlayWebsiteLayout } from "@/lib/website/settings";
import { AI_CONFIG_KEYS, SEARCH_DEFAULT_KEYS, assembleLocationConfig, routeConfigPatch, type LocationConfig } from "./model";

export type { LocationConfig } from "./model";

/**
 * A Location's configuration as one row, replacing the retired SiteConfig table: AI and transcript settings from the AI
 * settings document, website layout and search defaults from the website document, domain and Substo site address from
 * Location, and business details from the Business profile. Callers authorise first.
 */
export async function getLocationConfig(locationId: string): Promise<LocationConfig> {
    const [location, ai, website, view] = await Promise.all([
        db.location.findUnique({ where: { id: locationId }, select: { domain: true, websiteSlug: true, websitePublished: true } }),
        settingsService.getDocument<Record<string, unknown>>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI }),
        getWebsiteSettings(locationId),
        getBusinessViewIfAny(locationId),
    ]);
    const row = assembleLocationConfig({ locationId, location, ai: ai?.payload ?? null, website: website?.payload ?? null });
    return overlayBusinessDetails(overlayWebsiteLayout(row, website?.payload), view);
}

/** Configs for many Locations (maintenance jobs); every Location when ids are omitted. */
export async function getLocationConfigs(locationIds?: string[]): Promise<LocationConfig[]> {
    const ids = locationIds ?? (await db.location.findMany({ select: { id: true } })).map(l => l.id);
    return Promise.all(ids.map(getLocationConfig));
}

/** The Location whose Substo site has this address, if published. */
export async function findPublishedWebsiteLocation(slug: string) {
    return db.location.findFirst({ where: { websiteSlug: slug, websitePublished: true, authRealm: "substo" }, select: { id: true, name: true, websiteSlug: true } });
}

/**
 * Saves operational settings to their home: AI keys to the AI document, layout and search defaults to the website
 * document, domain and Substo address to Location. Business details are refused here (use saveBusinessDetails).
 */
export async function saveLocationConfig(locationId: string, patch: Partial<LocationConfig>, actorUserId: string | null) {
    const route = routeConfigPatch(patch);
    if (route.business.length) throw new Error(`Business details are saved through the Business profile: ${route.business.join(", ")}`);
    if (Object.keys(route.ai).length) {
        const current = await settingsService.getDocument<Record<string, unknown>>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
        await settingsService.upsertDocument({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
            payload: { ...(current?.payload ?? {}), ...route.ai }, actorUserId, expectedVersion: current?.version ?? 0, schemaVersion: 1 });
    }
    if (Object.keys(route.website).length) await saveWebsiteLayout(locationId, route.website, actorUserId);
    if (Object.keys(route.location).length) await db.location.update({ where: { id: locationId }, data: route.location });
}

export { AI_CONFIG_KEYS, SEARCH_DEFAULT_KEYS };
