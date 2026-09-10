import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import db from "@/lib/db";
import { resolvePublicSiteDomain } from "@/lib/public-site-domains/service";

export type PublicSiteContact = {
    id: string;
    locationId: string;
    name?: string | null;
    email?: string | null;
    propertiesInterested?: string[];
};

export type PublicSiteContactContext = {
    userId: string;
    locationId: string;
    hostname: string;
    contact: PublicSiteContact | null;
};

export type PublicSiteContextFailureReason =
    | "unauthenticated"
    | "unknown_domain"
    | "domain_unavailable"
    | "tenant_mismatch"
    | "contact_not_found"
    | "contact_tenant_mismatch";

export type PublicSiteContextResult =
    | { ok: true; context: PublicSiteContactContext }
    | { ok: false; reason: PublicSiteContextFailureReason };

type HeadersLike = Pick<Headers, "get">;

type PublicSiteContextDependencies = {
    getUserId: () => Promise<string | null>;
    getRequestHeaders: () => Promise<HeadersLike>;
    resolveDomain: (hostname: string) => Promise<{ locationId: string } | null>;
    findContact: (userId: string) => Promise<PublicSiteContact | null>;
};

const defaultDependencies: PublicSiteContextDependencies = {
    getUserId: async () => (await auth()).userId,
    getRequestHeaders: async () => await headers(),
    resolveDomain: resolvePublicSiteDomain,
    findContact: async (userId) => db.contact.findUnique({
        where: { clerkUserId: userId },
        select: {
            id: true,
            locationId: true,
            name: true,
            email: true,
            propertiesInterested: true,
        },
    }),
};

export function getPublicSiteRequestHostname(requestHeaders: HeadersLike): string | null {
    const rawHost = requestHeaders.get("host") || requestHeaders.get("x-forwarded-host");
    const firstHost = rawHost?.split(",", 1)[0]?.trim().toLowerCase();
    if (!firstHost) return null;

    if (firstHost.startsWith("[")) {
        const closingBracket = firstHost.indexOf("]");
        return closingBracket >= 0 ? firstHost.slice(1, closingBracket) : null;
    }

    return firstHost.replace(/:\d+$/, "").replace(/\.+$/, "") || null;
}

/**
 * Resolves the public-site tenant from the incoming hostname, then binds the
 * authenticated Clerk identity to a Contact in that same tenant. Bound action
 * arguments and client location IDs are consistency assertions only.
 */
export async function resolvePublicSiteContactContext(
    options: {
        expectedLocationId?: string;
        assertedLocationId?: string | null;
        requireContact?: boolean;
        requestHeaders?: HeadersLike;
        userId?: string | null;
    } = {},
    dependencies: PublicSiteContextDependencies = defaultDependencies,
): Promise<PublicSiteContextResult> {
    const userId = options.userId === undefined
        ? await dependencies.getUserId()
        : options.userId;
    if (!userId) return { ok: false, reason: "unauthenticated" };

    const requestHeaders = options.requestHeaders || await dependencies.getRequestHeaders();
    const hostname = getPublicSiteRequestHostname(requestHeaders);
    if (!hostname) return { ok: false, reason: "unknown_domain" };

    let resolution: { locationId: string } | null;
    try {
        resolution = await dependencies.resolveDomain(hostname);
    } catch {
        return { ok: false, reason: "domain_unavailable" };
    }
    if (!resolution) return { ok: false, reason: "unknown_domain" };

    if (options.expectedLocationId !== undefined && options.expectedLocationId !== resolution.locationId) {
        return { ok: false, reason: "tenant_mismatch" };
    }
    if (options.assertedLocationId != null && options.assertedLocationId !== resolution.locationId) {
        return { ok: false, reason: "tenant_mismatch" };
    }

    const contact = await dependencies.findContact(userId);
    if (contact && contact.locationId !== resolution.locationId) {
        return { ok: false, reason: "contact_tenant_mismatch" };
    }
    if (options.requireContact !== false && !contact) {
        return { ok: false, reason: "contact_not_found" };
    }

    return {
        ok: true,
        context: {
            userId,
            locationId: resolution.locationId,
            hostname,
            contact,
        },
    };
}
