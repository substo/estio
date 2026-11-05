import "server-only";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { overlayWebsiteLayout, websiteLayoutOnly } from "./settings";

/** The Location's website settings document (layout only). Callers authorise first. See settings.ts. */
const scope = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE });

export async function getWebsiteSettings(locationId: string) {
    const document = await settingsService.getDocument<Record<string, any>>(scope(locationId));
    return document ? { payload: document.payload, version: document.version } : null;
}

/** Saves layout keys into the website document, keeping every key not in the patch. Fails if someone saved in between. */
export async function saveWebsiteLayout(locationId: string, patch: Record<string, unknown>, actorUserId: string | null | undefined, expectedVersion?: number | null) {
    const current = await getWebsiteSettings(locationId);
    const payload = websiteLayoutOnly({ ...(current?.payload ?? {}), ...patch });
    return settingsService.upsertDocument({ ...scope(locationId), payload, actorUserId: actorUserId ?? null, expectedVersion: expectedVersion ?? current?.version ?? 0, schemaVersion: 1 });
}

/** A website config row (SiteConfig shape) with its layout taken from the website document. */
export async function withWebsiteLayout<T extends Record<string, any> | null | undefined>(row: T, locationId: string | null | undefined): Promise<T> {
    if (!row || !locationId) return row;
    return overlayWebsiteLayout(row, (await getWebsiteSettings(locationId))?.payload);
}
