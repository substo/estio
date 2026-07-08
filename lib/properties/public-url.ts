import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";

export const PUBLIC_LISTING_URL_MODES = {
    ESTIO: "ESTIO",
    LEGACY_EXTERNAL: "LEGACY_EXTERNAL",
} as const;

export type PublicListingUrlMode = typeof PUBLIC_LISTING_URL_MODES[keyof typeof PUBLIC_LISTING_URL_MODES];

type PropertyPublicUrlInput = {
    id?: string | null;
    locationId?: string | null;
    slug?: string | null;
    reference?: string | null;
    externalPublicUrl?: string | null;
    legacyCrmPropertyId?: string | null;
};

type LocationPublicUrlSettings = {
    publicListingUrlMode?: string | null;
    legacyPublicListingUrlPattern?: string | null;
    domain?: string | null;
    siteConfig?: { domain?: string | null } | null;
};

function normalizeText(value: unknown): string {
    return String(value || "").trim();
}

function normalizeDomain(value: unknown): string | null {
    const normalized = normalizeText(value)
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
    return normalized || null;
}

export function buildEstioPropertyPublicUrl(domain: string | null | undefined, slug: string | null | undefined) {
    const normalizedDomain = normalizeDomain(domain);
    const normalizedSlug = normalizeText(slug);
    if (!normalizedDomain || !normalizedSlug) return null;
    return `https://${normalizedDomain}/properties/${encodeURIComponent(normalizedSlug)}`;
}

export function getLegacyPublicBaseUrl(crmUrl: string | null | undefined) {
    const raw = normalizeText(crmUrl);
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        parsed.pathname = parsed.pathname.replace(/\/admin(?:\/.*)?$/i, "").replace(/\/+$/, "");
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/+$/, "");
    } catch {
        return null;
    }
}

export function buildLegacyPublicListingUrl(args: {
    crmUrl?: string | null;
    pattern?: string | null;
    slug?: string | null;
    reference?: string | null;
    legacyCrmPropertyId?: string | null;
    preview?: boolean;
}) {
    const slug = normalizeText(args.slug);
    const reference = normalizeText(args.reference);
    const legacyCrmPropertyId = normalizeText(args.legacyCrmPropertyId);
    const baseUrl = getLegacyPublicBaseUrl(args.crmUrl);
    const pattern = normalizeText(args.pattern);

    let url: string | null = null;
    if (pattern) {
        url = pattern
            .replace(/\{slug\}/g, encodeURIComponent(slug))
            .replace(/\{reference\}/g, encodeURIComponent(reference))
            .replace(/\{oldCrmId\}/g, encodeURIComponent(legacyCrmPropertyId))
            .replace(/\{id\}/g, encodeURIComponent(legacyCrmPropertyId));
    } else if (baseUrl && slug) {
        url = `${baseUrl}/properties/${encodeURIComponent(slug)}`;
    }

    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (args.preview) parsed.searchParams.set("preview", "true");
        return parsed.toString();
    } catch {
        return null;
    }
}

export function resolvePropertyPublicUrlFromSettings(args: {
    property: PropertyPublicUrlInput;
    location: LocationPublicUrlSettings;
}) {
    const mode = normalizeText(args.location.publicListingUrlMode) || PUBLIC_LISTING_URL_MODES.ESTIO;
    const estioDomain = args.location.siteConfig?.domain || args.location.domain || null;
    const estioUrl = buildEstioPropertyPublicUrl(estioDomain, args.property.slug);

    if (mode !== PUBLIC_LISTING_URL_MODES.LEGACY_EXTERNAL) {
        return estioUrl;
    }

    return normalizeText(args.property.externalPublicUrl)
        || buildLegacyPublicListingUrl({
            pattern: args.location.legacyPublicListingUrlPattern,
            slug: args.property.slug,
            reference: args.property.reference,
            legacyCrmPropertyId: args.property.legacyCrmPropertyId,
        })
        || estioUrl;
}

export async function resolvePropertyPublicUrl(args: {
    locationId: string;
    property: PropertyPublicUrlInput;
}) {
    const [location, settingsDoc] = await Promise.all([
        db.location.findUnique({
            where: { id: args.locationId },
            select: {
                domain: true,
                publicListingUrlMode: true,
                legacyPublicListingUrlPattern: true,
                siteConfig: { select: { domain: true } },
            },
        }),
        settingsService.getDocument<Record<string, unknown>>({
            scopeType: "LOCATION",
            scopeId: args.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CRM,
        }).catch(() => null),
    ]);
    if (!location) return null;
    const payload = settingsDoc?.payload || {};
    return resolvePropertyPublicUrlFromSettings({
        property: args.property,
        location: {
            ...location,
            publicListingUrlMode: normalizeText(payload.publicListingUrlMode) || location.publicListingUrlMode,
            legacyPublicListingUrlPattern: normalizeText(payload.legacyPublicListingUrlPattern) || location.legacyPublicListingUrlPattern,
        },
    });
}
