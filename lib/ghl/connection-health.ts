import type { Location } from "@prisma/client";
import { refreshGhlAccessToken } from "@/lib/location";
import { GHLError } from "@/lib/ghl/client";
import { getLocation as getGhlLocation } from "@/lib/ghl/locations";

export type GhlConnectionHealthStatus = "not_connected" | "connected" | "broken" | "unknown";

export type GhlConnectionHealth = {
    status: GhlConnectionHealthStatus;
    reason: string;
    checkedAt: string;
    ghlLocationId: string | null;
    ghlAgencyId: string | null;
    expiresAt: string | null;
    remoteLocationName: string | null;
};

type GhlLocationLike = Pick<
    Location,
    | "id"
    | "ghlAccessToken"
    | "ghlRefreshToken"
    | "ghlTokenType"
    | "ghlExpiresAt"
    | "ghlScopes"
    | "ghlLocationId"
    | "ghlAgencyId"
    | "ghlInstallId"
>;

type HealthDeps = {
    refreshToken: (location: GhlLocationLike) => Promise<GhlLocationLike>;
    fetchLocation: (accessToken: string, locationId: string) => Promise<{ location?: { name?: string | null } | null }>;
    now: () => Date;
};

const defaultDeps: HealthDeps = {
    refreshToken: (location) => refreshGhlAccessToken(location),
    fetchLocation: getGhlLocation,
    now: () => new Date(),
};

function baseHealth(location: GhlLocationLike, deps: HealthDeps): Omit<GhlConnectionHealth, "status" | "reason" | "remoteLocationName"> {
    return {
        checkedAt: deps.now().toISOString(),
        ghlLocationId: location.ghlLocationId || null,
        ghlAgencyId: location.ghlAgencyId || null,
        expiresAt: location.ghlExpiresAt ? new Date(location.ghlExpiresAt).toISOString() : null,
    };
}

export function classifyGhlHealthError(error: unknown): Pick<GhlConnectionHealth, "status" | "reason"> {
    if (error instanceof GHLError) {
        if (error.status === 401 || error.status === 403) {
            return {
                status: "broken",
                reason: "GoHighLevel authorization was revoked or no longer has access to this location.",
            };
        }

        if (error.status === 404) {
            return {
                status: "broken",
                reason: "GoHighLevel location unavailable or app authorization revoked.",
            };
        }

        if (error.status >= 500) {
            return {
                status: "unknown",
                reason: "GoHighLevel could not confirm the connection right now. Try refreshing shortly.",
            };
        }
    }

    const message = error instanceof Error ? error.message : String(error || "");
    if (/refresh|token|unauthori[sz]ed|forbidden|revoked/i.test(message)) {
        return {
            status: "broken",
            reason: "GoHighLevel token refresh failed. Reconnect or disconnect this integration.",
        };
    }

    return {
        status: "unknown",
        reason: "Could not confirm GoHighLevel connection health right now.",
    };
}

export async function getGhlConnectionHealth(
    location: GhlLocationLike,
    deps: Partial<HealthDeps> = {}
): Promise<GhlConnectionHealth> {
    const resolvedDeps = { ...defaultDeps, ...deps };
    const base = baseHealth(location, resolvedDeps);

    if (!location.ghlLocationId || !location.ghlAccessToken || !location.ghlRefreshToken) {
        return {
            ...base,
            status: "not_connected",
            reason: "This Estio location does not have a complete GoHighLevel connection.",
            remoteLocationName: null,
        };
    }

    try {
        const refreshed = await resolvedDeps.refreshToken(location);
        const accessToken = refreshed.ghlAccessToken || location.ghlAccessToken;
        if (!accessToken) {
            return {
                ...baseHealth(refreshed, resolvedDeps),
                status: "broken",
                reason: "GoHighLevel token refresh did not return an access token.",
                remoteLocationName: null,
            };
        }

        const remote = await resolvedDeps.fetchLocation(accessToken, location.ghlLocationId);
        return {
            ...baseHealth(refreshed, resolvedDeps),
            status: "connected",
            reason: "GoHighLevel connection is healthy.",
            remoteLocationName: remote.location?.name || null,
        };
    } catch (error) {
        const classified = classifyGhlHealthError(error);
        return {
            ...base,
            ...classified,
            remoteLocationName: null,
        };
    }
}
